// Vérification du module pur « La semaine qui vient » (Chantier 07, Bilan Semaine).
//
// Ce module ne recalcule pas le planning : il découpe la proposition du moteur
// sur les 7 jours suivant la semaine du bilan. Les scénarios ci-dessous
// vérifient surtout qu'il n'élargit JAMAIS la fenêtre en silence et qu'il ne
// transforme pas un débordement d'horizon en date de fin.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bilanSemaineProchaineV1,
  fenetreSemaineProchaineV1,
  lundiSemaineISOv1,
  ajouterJoursV1,
  BILAN_SEMAINE_PROCHAINE_VERSION,
  JOURS_SEMAINE_PROCHAINE,
} from "../src/Renovation/bilanSemaineProchaineV1.mjs";
import { libelleFinPrevisionnelleV1 } from "../src/Renovation/planningFinPrevisionnelleV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/bilanSemaineProchaineV1.mjs"), "utf8");

// 0. Pureté : aucun accès base, aucune écriture, aucune horloge, aucun Date.
assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "la semaine qui vient doit rester pure");
assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(/.test(source), false, "la semaine qui vient ne doit rien persister");
assert.equal(/new Date\s*\(|Date\.now\s*\(|Date\.UTC\s*\(/.test(source), false, "la semaine qui vient ne doit dépendre d'aucune horloge ni d'aucun fuseau");

const alloc = (chantierId, date, resourceIds, duree = 7, texte = `Travaux ${chantierId}`) => ({
  allocation_uid: `A-${chantierId}-${date}-${resourceIds.join("-")}`,
  chantier_id: chantierId, date, texte, duree,
  resource_ids: resourceIds, heures_mo: duree * resourceIds.length,
});
const nonPlanifie = (chantierId, travailId, heures) => ({
  travail_id: travailId, tache_id: travailId, chantier_id: chantierId,
  heures_mo_restantes: heures, raison: "horizon_insuffisant",
});
const chantierDe = (out, id) => out.par_chantier.find(c => c.chantier_id === id);
const personneDe = (out, id) => out.par_personne.find(p => p.resource_id === id);

// ── 1. La fenêtre : les 7 jours qui SUIVENT la semaine du bilan. ──
{
  // 2026-W39 commence le lundi 21/09/2026 ; la semaine qui vient = 28/09 → 04/10.
  assert.equal(lundiSemaineISOv1("2026-W39"), "2026-09-21");
  const fen = fenetreSemaineProchaineV1("2026-W39");
  assert.equal(fen.debut, "2026-09-28");
  assert.equal(fen.fin, "2026-10-04");
  assert.equal(fen.jours.length, JOURS_SEMAINE_PROCHAINE);
  assert.deepEqual(fen.jours, [
    "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  ]);

  // La semaine 1 est bien celle qui contient le 4 janvier (règle ISO-8601).
  assert.equal(lundiSemaineISOv1("2026-W01"), "2025-12-29");
  assert.equal(lundiSemaineISOv1("2027-W01"), "2027-01-04");
  // Le lundi du bilan peut aussi être donné directement.
  assert.equal(fenetreSemaineProchaineV1("2026-09-21").debut, "2026-09-28");
  // Arithmétique de dates : passage de mois, d'année, année bissextile.
  assert.equal(ajouterJoursV1("2026-12-30", 3), "2027-01-02");
  assert.equal(ajouterJoursV1("2028-02-28", 1), "2028-02-29");
  assert.equal(ajouterJoursV1("2026-03-01", -1), "2026-02-28");
  // Entrées illisibles : null, jamais une date inventée.
  assert.equal(lundiSemaineISOv1("2026-W54"), null);
  assert.equal(lundiSemaineISOv1("pas-une-semaine"), null);
  assert.equal(ajouterJoursV1("bruit", 2), null);
  assert.equal(fenetreSemaineProchaineV1(""), null);
}

// ── 2. Une semaine avec des allocations sur plusieurs chantiers. ──
{
  const out = bilanSemaineProchaineV1({
    semaineDuBilan: "2026-W39",
    resultatMoteur: {
      allocations_proposees: [
        alloc("CB", "2026-10-01", ["R1", "R2"], 7),
        alloc("CA", "2026-09-28", ["R1"], 7),
        alloc("CA", "2026-09-29", ["R1", "R3"], 6),
        alloc("CC", "2026-10-02", ["R3"], 4),
      ],
      non_planifies: [],
    },
  });
  assert.equal(out.version, BILAN_SEMAINE_PROCHAINE_VERSION);
  // Chantiers triés par premier jour d'intervention.
  assert.deepEqual(out.par_chantier.map(c => c.chantier_id), ["CA", "CB", "CC"]);

  const ca = chantierDe(out, "CA");
  assert.deepEqual(ca.jours, ["2026-09-28", "2026-09-29"]);
  assert.equal(ca.nb_allocations, 2);
  assert.equal(ca.heures_mo, 19); // 7×1 + 6×2
  assert.deepEqual(ca.resource_ids, ["R1", "R3"]);

  // Par personne : les heures sont la DURÉE sur place, pas la MO de l'équipe.
  const r1 = personneDe(out, "R1");
  assert.equal(r1.heures_mo, 20); // 7 (CA) + 6 (CA) + 7 (CB)
  assert.equal(r1.nb_chantiers, 2);
  assert.deepEqual(r1.chantiers.map(c => c.chantier_id), ["CA", "CB"]);
  assert.equal(r1.chantiers.find(c => c.chantier_id === "CA").heures_mo, 13);
  assert.deepEqual(r1.jours, ["2026-09-28", "2026-09-29", "2026-10-01"]);

  assert.deepEqual(out.resume, {
    // 19 h (CA) + 14 h (CB) + 4 h (CC) de MO cumulée équipe.
    chantiers: 3, personnes: 3, heures_mo: 37, allocations_retenues: 4,
    allocations_hors_fenetre: 0, jours_couverts: 4, chantiers_au_dela_horizon: 0,
  });

  // Déterminisme strict à entrées identiques.
  const bis = bilanSemaineProchaineV1({
    semaineDuBilan: "2026-W39",
    resultatMoteur: {
      allocations_proposees: [
        alloc("CB", "2026-10-01", ["R1", "R2"], 7),
        alloc("CA", "2026-09-28", ["R1"], 7),
        alloc("CA", "2026-09-29", ["R1", "R3"], 6),
        alloc("CC", "2026-10-02", ["R3"], 4),
      ],
      non_planifies: [],
    },
  });
  assert.deepEqual(bis, out);
}

// ── 3. Une semaine sans aucune allocation : vide assumé, pas d'erreur. ──
{
  const out = bilanSemaineProchaineV1({
    semaineDuBilan: "2026-W39",
    resultatMoteur: { allocations_proposees: [], non_planifies: [] },
  });
  assert.deepEqual(out.par_chantier, []);
  assert.deepEqual(out.par_personne, []);
  assert.equal(out.resume.chantiers, 0);
  assert.equal(out.resume.heures_mo, 0);
  // La fenêtre reste renseignée : « rien de prévu » n'est pas « pas de semaine ».
  assert.equal(out.fenetre.debut, "2026-09-28");
}

// ── 4. Les allocations HORS de la fenêtre de 7 jours sont exclues. ──
{
  const out = bilanSemaineProchaineV1({
    semaineDuBilan: "2026-W39",
    resultatMoteur: {
      allocations_proposees: [
        alloc("CX", "2026-09-27", ["R1"], 7), // veille du début → exclue
        alloc("CX", "2026-09-28", ["R1"], 7), // premier jour → incluse
        alloc("CX", "2026-10-04", ["R1"], 5), // dernier jour → incluse
        alloc("CX", "2026-10-05", ["R1"], 7), // lendemain de la fin → exclue
        alloc("CY", "2026-11-30", ["R2"], 7), // bien plus tard → exclue
        alloc("CZ", "2026-09-21", ["R2"], 7), // semaine du bilan → exclue
      ],
      non_planifies: [],
    },
  });
  assert.deepEqual(out.par_chantier.map(c => c.chantier_id), ["CX"]);
  const cx = chantierDe(out, "CX");
  assert.deepEqual(cx.jours, ["2026-09-28", "2026-10-04"]);
  assert.equal(cx.heures_mo, 12);
  assert.equal(out.resume.allocations_retenues, 2);
  assert.equal(out.resume.allocations_hors_fenetre, 4);
  // Aucune personne ne doit hériter d'heures venues d'en dehors de la fenêtre.
  assert.equal(personneDe(out, "R1").heures_mo, 12);
  assert.equal(personneDe(out, "R2"), undefined);
}

// ── 5. Une personne sur DEUX chantiers le même jour est signalée. ──
{
  const out = bilanSemaineProchaineV1({
    semaineDuBilan: "2026-W39",
    resultatMoteur: {
      allocations_proposees: [
        alloc("CA", "2026-09-29", ["R1"], 4),
        alloc("CB", "2026-09-29", ["R1"], 3),
        alloc("CA", "2026-09-30", ["R1"], 7), // un seul chantier ce jour-là
        alloc("CA", "2026-09-29", ["R2"], 4), // R2 ne voit qu'un chantier
      ],
      non_planifies: [],
    },
  });
  const r1 = personneDe(out, "R1");
  assert.equal(r1.nb_chantiers, 2);
  assert.equal(r1.heures_mo, 14);
  assert.equal(r1.multi_chantiers_meme_jour.length, 1);
  assert.deepEqual(r1.multi_chantiers_meme_jour[0], { date: "2026-09-29", chantier_ids: ["CA", "CB"] });
  // R2 n'est sur qu'un chantier : rien à signaler.
  assert.deepEqual(personneDe(out, "R2").multi_chantiers_meme_jour, []);
}

// ── 6. Chantier dont la fin dépasse l'horizon : jamais de date sèche. ──
{
  const out = bilanSemaineProchaineV1({
    semaineDuBilan: "2026-W39",
    resultatMoteur: {
      allocations_proposees: [
        alloc("CA", "2026-09-28", ["R1"], 7),
        alloc("CDEB", "2026-09-30", ["R2"], 7),
      ],
      non_planifies: [nonPlanifie("CDEB", "TR-1", 21), nonPlanifie("CHORS", "TR-2", 8)],
    },
  });
  assert.deepEqual(out.chantiers_au_dela_horizon.map(c => c.chantier_id), ["CDEB", "CHORS"]);
  assert.equal(out.resume.chantiers_au_dela_horizon, 2);

  const deb = out.chantiers_au_dela_horizon.find(c => c.chantier_id === "CDEB");
  assert.equal(deb.complet, false);
  assert.equal(deb.fin_prevue, null, "un chantier qui déborde n'a pas de date de fin");
  assert.equal(deb.heures_non_planifiees, 21);
  // Le libellé réutilisé du 23/09 dit « pas avant le … », jamais « fin prévue ».
  const lib = libelleFinPrevisionnelleV1(deb, d => d.split("-").reverse().join("/"));
  assert.equal(lib.titre, "Au-delà de l'horizon");
  assert.match(lib.detail, /pas avant le 30\/09\/2026/);
  assert.equal(/Fin prévue/.test(lib.titre + lib.detail), false);

  // Un chantier qui déborde SANS créneau du tout reste listé, sans date.
  const hors = out.chantiers_au_dela_horizon.find(c => c.chantier_id === "CHORS");
  assert.equal(hors.derniere_date_allouee, null);
  // Le chantier entièrement planifié n'apparaît PAS dans les débordements.
  assert.equal(out.chantiers_au_dela_horizon.some(c => c.chantier_id === "CA"), false);
}

// ── 7. Résultat moteur vide ou malformé : rien ne casse, rien n'est inventé. ──
for (const entree of [undefined, null, 0, "", "planning", [], {}, { allocations_proposees: null, non_planifies: "x" }]) {
  const out = bilanSemaineProchaineV1({ semaineDuBilan: "2026-W39", resultatMoteur: entree });
  assert.deepEqual(out.par_chantier, []);
  assert.deepEqual(out.par_personne, []);
  assert.deepEqual(out.chantiers_au_dela_horizon, []);
  assert.equal(out.resume.heures_mo, 0);
  assert.equal(out.fenetre.debut, "2026-09-28");
}
{
  // Aucun argument du tout, et semaine illisible : fenêtre nulle, pas d'exception.
  const rien = bilanSemaineProchaineV1();
  assert.equal(rien.fenetre, null);
  assert.deepEqual(rien.par_chantier, []);
  const mauvaiseSemaine = bilanSemaineProchaineV1({
    semaineDuBilan: "n'importe quoi",
    resultatMoteur: { allocations_proposees: [alloc("CA", "2026-09-28", ["R1"])] },
  });
  assert.equal(mauvaiseSemaine.fenetre, null);
  assert.deepEqual(mauvaiseSemaine.par_chantier, []);
}
{
  // Lignes individuelles corrompues : ignorées sans faire tomber le calcul.
  const out = bilanSemaineProchaineV1({
    semaineDuBilan: "2026-W39",
    resultatMoteur: {
      allocations_proposees: [
        null, 42, "bruit",
        { chantier_id: "", date: "2026-09-28", resource_ids: ["R1"] },      // chantier vide → ignoré
        { chantier_id: "CA", date: "pas-une-date", resource_ids: ["R1"] },  // date illisible → ignorée
        { chantier_id: "CA", date: "2026-09-28T07:30:00Z", resource_ids: null, heures_mo: "abc" },
        { chantier_id: "CA", date: "2026-09-29", resource_ids: ["R1", ""], heures_mo: 10 }, // pas de duree
      ],
      non_planifies: [null, "bruit"],
    },
  });
  const ca = chantierDe(out, "CA");
  assert.equal(out.par_chantier.length, 1);
  assert.equal(ca.nb_allocations, 2);          // horodatage toléré + ligne sans duree
  assert.deepEqual(ca.jours, ["2026-09-28", "2026-09-29"]);
  assert.equal(ca.heures_mo, 10);              // "abc" compte pour 0
  assert.deepEqual(ca.resource_ids, ["R1"]);   // la ressource vide est écartée
  assert.equal(personneDe(out, "R1").heures_mo, 10); // heures_mo / 1 ressource retenue
}

// ── 8. Aucun effet de bord : l'entrée n'est pas modifiée. ──
{
  const entree = {
    allocations_proposees: [alloc("CS", "2026-09-28", ["R1"], 7)],
    non_planifies: [nonPlanifie("CS", "TR-1", 4)],
  };
  const copie = structuredClone(entree);
  bilanSemaineProchaineV1({ semaineDuBilan: "2026-W39", resultatMoteur: entree });
  assert.deepEqual(entree, copie, "le découpage ne doit jamais muter le résultat du moteur");
}

console.log("OK — bilan semaine prochaine V1 : 8 scénarios");
