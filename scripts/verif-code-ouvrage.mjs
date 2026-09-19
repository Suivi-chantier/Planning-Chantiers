#!/usr/bin/env node
// Vérifie le détecteur unique de codes d'ouvrage (src/Renovation/codeOuvrage.mjs)
// et sa reprise par les cinq anciens points de détection.
//   node scripts/verif-code-ouvrage.mjs
import assert from "node:assert/strict";
import { chargerModuleSource } from "./_chargeur.mjs";

const c = await import(new URL("../src/Renovation/codeOuvrage.mjs", import.meta.url).href);

// ── Codes réels de la bibliothèque ──────────────────────────────────────────
assert.deepEqual(
  pick(c.parseCodeOuvrage("COUV-001 :  Reprise de couverture à réaliser")),
  { prefixe: "COUV", numero: "001", code: "COUV-001", reste: "Reprise de couverture à réaliser" },
);
assert.equal(c.codeOuvrage("D-001 : Décollage et enlèvement"), "D-001");
assert.equal(c.codeOuvrage("D-0062 : Percement d'ouverture"), "D-0062");
assert.equal(c.codeOuvrage("E-002.3 : Fourniture et pose d'un tableau"), "E-002.3");
assert.equal(c.codeOuvrage("MU-001 Fourniture et pose d'un doublage"), "MU-001");
assert.equal(c.parseCodeOuvrage("MU-001 Fourniture et pose d'un doublage").reste, "Fourniture et pose d'un doublage");
assert.equal(c.codeOuvrage("D-009 Démolition du torchis"), "D-009");
assert.equal(c.codeOuvrage("P-1000 Fourniture et pose d'un WC"), "P-1000");
assert.equal(c.codeOuvrage("ME-0011 : Porte d'entrée PVC"), "ME-0011");
assert.equal(c.codeOuvrage("EG-001 : Goulotte"), "EG-001");
assert.equal(c.codeOuvrage("P-021.2 : Salle de bain type"), "P-021.2");
assert.equal(c.prefixeCodeOuvrage("COUV-001"), "COUV");
assert.equal(c.prefixeCodeOuvrage("COUV-001 : libellé"), "COUV");
assert.equal(c.parseCodeOuvrage("COUV-001").reste, "COUV-001", "reste = libellé complet si rien ne suit le code");

// ── Formes tolérées à l'import Excel ────────────────────────────────────────
assert.equal(c.codeOuvrage("e-001 prise courant"), "E-001", "minuscules acceptées avec séparateur explicite");
assert.equal(c.codeOuvrage("E001 prise"), "E-001");
assert.equal(c.codeOuvrage("E 001 prise"), "E-001");
assert.equal(c.codeOuvrage("E.001 prise"), "E-001");

// ── Faux positifs évités ────────────────────────────────────────────────────
assert.equal(c.codeOuvrage("Pose 3 prises"), null, "mot en minuscules + espace ≠ code");
assert.equal(c.codeOuvrage("Bac 3"), null);
assert.equal(c.codeOuvrage("Installation électrique T2"), null);
assert.equal(c.codeOuvrage("Fenêtre PVC 600x750"), null);
assert.equal(c.codeOuvrage(""), null);
assert.equal(c.codeOuvrage(null), null);
assert.equal(c.codeOuvrage("ABCDEF-001 trop long"), null, "6 lettres refusées");

// ── Tri & lot ───────────────────────────────────────────────────────────────
const tries = ["MU-002 x", "D-010 y", "D-002 z", "Sans code", "COUV-001 w"].sort(c.comparerCodes);
assert.deepEqual(tries, ["COUV-001 w", "D-002 z", "D-010 y", "MU-002 x", "Sans code"]);
const lots = [{ id: "murs_cloison", code_prefixe: "MU" }, { id: "demolition", code_prefixe: "d" }];
assert.equal(c.lotParCode("MU-001 Doublage", lots).id, "murs_cloison");
assert.equal(c.lotParCode("D-001 : Dépose", lots).id, "demolition");
assert.equal(c.lotParCode("COUV-001 : Couverture", lots), null);

// ── Reprise par les anciens détecteurs ──────────────────────────────────────
const pm = await chargerModuleSource("../src/Renovation/planningModelV1.js", import.meta.url);
assert.equal(pm.codeOuvrageDepuisLibelle("COUV-001 : Reprise"), "COUV-001");
assert.equal(pm.codeOuvrageDepuisLibelle("E-007 : Point lumineux"), "E-007");
const di = await chargerModuleSource("../src/Renovation/planningDependencyInferenceV1.js", import.meta.url);
assert.equal(di.codeOuvrageV1("COUV-001 : Reprise"), "COUV-001");
const gi = await chargerModuleSource("../src/Renovation/planningGroupInferenceV1.js", import.meta.url);
assert.equal(gi.prefixeCodeOuvrage("COUV-001"), "COUV");
assert.equal(gi.prefixeCodeOuvrage("ME-003"), "ME");

// devisImport.js importe xlsx : on vérifie uniquement la forme historique
// { prefix, number, full, rest } via le module central (même fonction).
const ex = c.parseCodeOuvrage("COUV-001 : Reprise");
assert.deepEqual({ prefix: ex.prefixe, number: ex.numero, full: ex.code, rest: ex.reste }, { prefix: "COUV", number: "001", full: "COUV-001", rest: "Reprise" });

function pick(r) { return r && { prefixe: r.prefixe, numero: r.numero, code: r.code, reste: r.reste }; }

console.log("verif-code-ouvrage : OK (COUV-001 reconnu partout)");
