#!/usr/bin/env node
// Vérifie le bloc du jour « Matériaux à commander » (projet
// docs/projets/organisation-par-jour.md, tâche 12, décision de Loris du
// 24/11/2026 : articles de la page Commandes à passer dont la date de besoin
// tombe la semaine suivante) et l'extraction faite pour lui depuis la page
// (fenêtre « Commandes de la semaine », ModaleVendredi de
// PagePlanningCommandes.jsx) :
//
//   1. rangement par semaine : semainesCommandesV1 / seauxCommandesV1 /
//      ongletsCommandesV1 = EXACTEMENT l'ancien code de la fenêtre (recopié
//      ici tel qu'il était, `new Date()` remplacé par la date testée), pour
//      chaque jour de 2026 et 2027, à plusieurs heures de la journée, avec
//      des articles en retard, sans date, plus tard ;
//   2. date du jour : le bloc passe minuit local de contexte.dateIso ; sans
//      date simulée (même jour que l'horloge), mêmes semaines et mêmes seaux
//      que la page, quelle que soit l'heure ; refait sous le fuseau de Paris ;
//   3. chaîne complète : modeleCommandesAPasser → lignesACommander →
//      onglet « Semaine prochaine » ; le bloc compte les mêmes articles ;
//   4. bloc : total, par chantier (articles, date de besoin la plus proche),
//      6 articles les plus urgents + « et N autres », métrique ;
//   5. impossibilités visibles : chargement, erreur, date illisible,
//      « Aucun matériau à commander pour la semaine 49 » ;
//   6. statique : la page et le bloc passent par les mêmes fonctions, module
//      pur, registre branché, workflow, Journal des MAJ.
//
// Données fictives uniquement. Aucun réseau, aucune base.
//   node scripts/verif-bloc-materiaux-a-commander.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as W from "../src/Renovation/commandesParSemaineV1.mjs";
import * as C from "../src/Renovation/commandesAPasserV1.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── ANCIEN code de la fenêtre (PagePlanningCommandes.jsx, origin/main avant la
//    tâche 12), recopié tel quel. Seul changement : `new Date()` → `maintenant`.
function ancienLundiSemaine(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Dim ... 6=Sam
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function ancienAddDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function ancienNumeroSemaine(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil((((x - yearStart) / 86400000) + 1) / 7);
}
function ancienneFenetre(lignes, maintenant) {
  const semaines = (() => {
    const lundi0 = ancienLundiSemaine(maintenant);
    return Array.from({ length: 5 }, (_, i) => {
      const debut = ancienAddDays(lundi0, i * 7);
      const fin   = ancienAddDays(debut, 6);
      return {
        index: i, debut, fin,
        key: "S" + i,
        label: i === 0 ? "Cette semaine" : i === 1 ? "Semaine prochaine" : `S+${i}`,
        num: ancienNumeroSemaine(debut),
      };
    });
  })();
  const seaux = (() => {
    const out = {};
    semaines.forEach(s => { out[s.key] = []; });
    out["plus"] = [];
    out["sansdate"] = [];
    lignes.forEach(l => {
      if (!l.dateObj) { out["sansdate"].push(l); return; }
      const d = new Date(l.dateObj); d.setHours(0, 0, 0, 0);
      if (d < semaines[0].debut) { out[semaines[0].key].push(l); return; }
      let placed = false;
      for (const s of semaines) {
        if (d >= s.debut && d <= s.fin) { out[s.key].push(l); placed = true; break; }
      }
      if (!placed) out["plus"].push(l);
    });
    return out;
  })();
  const onglets = (() => {
    const arr = [];
    semaines.forEach(s => { if (seaux[s.key].length) arr.push({ key: s.key, label: s.label, num: s.num, deb: s.debut, fin: s.fin }); });
    if (seaux["plus"].length) arr.push({ key: "plus", label: "Plus tard", num: null });
    if (seaux["sansdate"].length) arr.push({ key: "sansdate", label: "Sans date", num: null });
    return arr;
  })();
  return { semaines, seaux, onglets };
}

// ── Jeu fictif (données inventées) ──────────────────────────────────────────
const iso = (d) => W.isoLocalV1(d);
const ligneDate = (dateISO, n) => ({ n, libelle: `Article fictif ${n}`, dateISO, dateObj: dateISO ? new Date(dateISO) : null });
function lignesAutour(jour) {
  const out = [ligneDate(null, 0), ligneDate("", 1)];
  for (let k = -20; k <= 45; k += 1) out.push(ligneDate(iso(W.addDays(jour, k)), out.length));
  return out;
}
const cles = (seaux) => Object.fromEntries(Object.entries(seaux).map(([k, v]) => [k, v.map((l) => l.n)]));
const jours = [];
for (let d = new Date(2026, 0, 1); d.getFullYear() < 2028; d = W.addDays(d, 1)) jours.push(new Date(d));

test("1. rangement par semaine = ancien code de la fenêtre « Commandes de la semaine », chaque jour de 2026 et 2027, plusieurs heures", () => {
  let n = 0;
  for (const jour of jours) {
    const lignes = lignesAutour(jour);
    for (const h of [0, 7, 12, 23]) {
      const maintenant = new Date(jour); maintenant.setHours(h, h === 23 ? 59 : 5, 0, 0);
      const A = ancienneFenetre(lignes, maintenant);
      const semaines = W.semainesCommandesV1(maintenant);
      const seaux = W.seauxCommandesV1(lignes, semaines);
      assert.deepEqual(semaines, A.semaines, `semaines ${maintenant}`);
      assert.deepEqual(cles(seaux), cles(A.seaux), `seaux ${maintenant}`);
      assert.deepEqual(W.ongletsCommandesV1(seaux, semaines), A.onglets, `onglets ${maintenant}`);
      // Onglet « Semaine prochaine » = seau S1.
      const sp = W.semaineProchaineCommandesV1({ lignes, aujourdhui: maintenant });
      assert.deepEqual(sp.lignes.map((l) => l.n), A.seaux.S1.map((l) => l.n));
      assert.equal(sp.semaine.label, "Semaine prochaine");
      n++;
    }
  }
  assert.ok(n >= 2900);
  // Aides de dates : mêmes résultats que les anciennes.
  for (const jour of jours.slice(0, 60)) {
    assert.deepEqual(W.lundiSemaine(jour), ancienLundiSemaine(jour));
    assert.deepEqual(W.addDays(jour, 9), ancienAddDays(jour, 9));
    assert.equal(W.numeroSemaine(jour), ancienNumeroSemaine(jour));
  }
});

test("2. date du jour : minuit local de contexte.dateIso = même résultat que l'horloge de la page (sans date simulée), à toute heure", () => {
  for (const jour of jours) {
    const lignes = lignesAutour(jour);
    const dateIso = iso(jour);
    const bloc = W.dateLocaleV1(dateIso);
    assert.equal(iso(bloc), dateIso);
    for (const h of [0, 9, 18, 23]) {
      const horloge = new Date(jour); horloge.setHours(h, 30, 0, 0);
      assert.equal(iso(horloge), dateIso, "même jour local");
      assert.deepEqual(W.semainesCommandesV1(bloc), W.semainesCommandesV1(horloge));
      assert.deepEqual(cles(W.seauxCommandesV1(lignes, W.semainesCommandesV1(bloc))), cles(ancienneFenetre(lignes, horloge).seaux));
    }
  }
  // Vendredi 27/11/2026 → semaine prochaine = S49, du lundi 30/11 au dimanche 06/12.
  const s = W.semainesCommandesV1(W.dateLocaleV1("2026-11-27"))[1];
  assert.equal(s.num, 49); assert.equal(iso(s.debut), "2026-11-30"); assert.equal(iso(s.fin), "2026-12-06");
  // Dimanche 29/11 : la semaine en cours commence le lundi 23 → semaine prochaine = S49 aussi (comme la page).
  assert.equal(W.semainesCommandesV1(W.dateLocaleV1("2026-11-29"))[1].num, 49);
  // Passage d'année : vendredi 25/12/2026 → S53 ; 01/01/2027 → S1.
  assert.equal(W.semainesCommandesV1(W.dateLocaleV1("2026-12-25"))[1].num, 53);
  assert.equal(W.semainesCommandesV1(W.dateLocaleV1("2027-01-01"))[1].num, 1);
  // Dates illisibles.
  for (const v of [null, undefined, "", "2026-13-01", "2026-02-30", "27/11/2026", 20261127]) assert.equal(W.dateLocaleV1(v), null, String(v));
});

// ── Chaîne complète (données fictives) ──────────────────────────────────────
const MATERIAUX = [
  { id: "m1", nom: "Plaque BA13 fictive", unite: "U", prix_unitaire: 8, fournisseur: "Fournisseur fictif A" },
  { id: "m2", nom: "Rail 48 fictif", unite: "U", prix_unitaire: 3, fournisseur: "Fournisseur fictif A" },
  { id: "m3", nom: "Tube PER fictif", unite: "m", prix_unitaire: 1.2, fournisseur: "Fournisseur fictif B" },
  { id: "m4", nom: "Câble fictif", unite: "m", prix_unitaire: 0.8, fournisseur: "Fournisseur fictif C" },
];
const CHANTIERS = [{ id: "ch-a", nom: "CHANTIER FICTIF A", couleur: "#f00" }, { id: "ch-b", nom: "CHANTIER FICTIF B", couleur: "#0f0" }];
const ouv = (id, dates, liens, extra = {}) => ({ id, libelle: `Ouvrage fictif ${id}`, lot_id: "lot", taches: dates.map((d) => ({ date_prevue: d, avancement: extra.avancement ?? 0 })), materiaux_liens: liens, ...extra });
const PHASAGES = [
  { id: "p1", chantier_id: "ch-a", ouvrages: [
    ouv("o1", ["2026-12-02", "2026-12-01"], [{ materiau_id: "m1", quantite: 12 }, { materiau_id: "m2", quantite: 4 }]),   // S49 (01/12)
    ouv("o2", ["2026-11-20"], [{ materiau_id: "m3", quantite: 25 }]),                                                  // en retard → cette semaine
    ouv("o3", ["2026-12-06"], [{ materiau_id: "m4", quantite: 100 }, { materiau_id: "m1", commande_le: "2026-11-20" }]), // S49 dim. ; m1 marqué commandé
    ouv("o4", ["2026-12-03"], [{ materiau_id: "m2" }], { avancement: 100 }),                                            // terminé : plus nécessaire
    ouv("o5", [], [{ materiau_id: "m3" }]),                                                                              // sans date
    ouv("o6", ["2026-12-07"], [{ materiau_id: "m1", quantite: 2 }]),                                                    // S50
    ouv("o7", ["2026-11-30"], [{ materiau_id: "inconnu" }]),                                                            // hors bibliothèque
  ] },
  { id: "p2", chantier_id: "ch-b", ouvrages: [
    ouv("o8", ["2026-11-30"], [{ materiau_id: "m1", quantite: 5 }, { materiau_id: "m3", quantite: 8 }, { materiau_id: "m4", quantite: 50 }]), // S49 lundi
    ouv("o9", ["2026-12-04"], [{ materiau_id: "m2", quantite: 6 }]),                                                     // S49 ; commandé par une ligne
  ] },
];
const LIGNES_CMD = [{ id: "l1", materiau_id: "m2", ouvrage_id: "o9", chantier_id: "ch-b", nature: "materiaux" }];
const lignesFictives = () => C.lignesACommander(C.modeleCommandesAPasser({
  phasages: PHASAGES, chantiers: CHANTIERS, matById: C.indexMateriaux(MATERIAUX), lotById: {}, lignesCmd: LIGNES_CMD, lots: [], achatsParCh: {},
}));

test("3. chaîne complète : lignesACommander → onglet « Semaine prochaine » ; le bloc compte les mêmes articles que la page (exemple issu des tests, données fictives)", () => {
  const lignes = lignesFictives();
  const vendredi = W.dateLocaleV1("2026-11-27");
  const A = ancienneFenetre(lignes, vendredi);
  const attendu = A.seaux.S1.map((l) => `${l.chantierNom}|${l.libelle}|${l.dateISO}`).sort();
  assert.deepEqual(attendu, [
    "CHANTIER FICTIF A|Câble fictif|2026-12-06",
    "CHANTIER FICTIF A|Plaque BA13 fictive|2026-12-01",
    "CHANTIER FICTIF A|Rail 48 fictif|2026-12-01",
    "CHANTIER FICTIF B|Câble fictif|2026-11-30",
    "CHANTIER FICTIF B|Plaque BA13 fictive|2026-11-30",
    "CHANTIER FICTIF B|Tube PER fictif|2026-11-30",
  ]);
  const e = W.etatBlocMateriauxACommanderV1({ dateIso: "2026-11-27", lignes });
  assert.equal(e.etat, "liste");
  assert.equal(e.articles.length + e.autres, A.seaux.S1.length);
  assert.equal(e.chantiers.reduce((s, c) => s + c.nb, 0), A.seaux.S1.length);
  assert.equal(e.metrique, "6 articles");
  assert.equal(e.total, "6 articles à commander · 2 chantiers");
  assert.deepEqual(e.chantiers.map((c) => [c.nom, c.nb, c.dateBesoin]), [
    ["CHANTIER FICTIF B", 3, "2026-11-30"],
    ["CHANTIER FICTIF A", 3, "2026-12-01"],
  ]);
  assert.equal(e.libelleSemaine, "Semaine prochaine · S49 · du 30/11 au 06/12");
  // Les plus urgents : date de besoin croissante, quantité + unité comme la fenêtre.
  assert.deepEqual(e.articles.map((a) => a.dateBesoin), ["2026-11-30", "2026-11-30", "2026-11-30", "2026-12-01", "2026-12-01", "2026-12-06"]);
  assert.deepEqual(e.articles[0], { libelle: "Plaque BA13 fictive", quantite: "5 U", ouvrage: "Ouvrage fictif o8", chantier: "CHANTIER FICTIF B", dateBesoin: "2026-11-30" });
  assert.equal(e.autres, 0);
});

test("4. bloc : 6 articles au plus + « et N autres », par chantier date de besoin la plus proche (exemple issu des tests, données fictives)", () => {
  const lignes = [];
  for (let i = 0; i < 11; i++) {
    const d = `2026-12-0${(i % 6) + 1}`;
    lignes.push({ libelle: `Article fictif ${i}`, quantite: i + 1, unite: "U", chantierId: i % 3 ? "x" : "y", chantierNom: i % 3 ? "CHANTIER FICTIF X" : "CHANTIER FICTIF Y", dateISO: d, dateObj: new Date(d), ouvrageLibelle: "Ouvrage fictif" });
  }
  lignes.push({ libelle: "Hors semaine", chantierId: "z", chantierNom: "CHANTIER FICTIF Z", dateISO: "2026-12-09", dateObj: new Date("2026-12-09") });
  lignes.push({ libelle: "Sans date", chantierId: "z", chantierNom: "CHANTIER FICTIF Z", dateISO: null, dateObj: null });
  const e = W.etatBlocMateriauxACommanderV1({ dateIso: "2026-11-27", lignes });
  assert.equal(e.metrique, "11 articles");
  assert.equal(e.articles.length, W.ARTICLES_MAX_BLOC_MATERIAUX);
  assert.equal(W.ARTICLES_MAX_BLOC_MATERIAUX, 6);
  assert.equal(e.autres, 5);
  assert.ok(e.articles.every((a, i, t) => i === 0 || t[i - 1].dateBesoin <= a.dateBesoin), "tri par date de besoin");
  assert.deepEqual(e.chantiers.map((c) => [c.nom, c.nb, c.dateBesoin]), [["CHANTIER FICTIF Y", 4, "2026-12-01"], ["CHANTIER FICTIF X", 7, "2026-12-02"]]);
  assert.ok(!e.chantiers.some((c) => c.nom === "CHANTIER FICTIF Z"), "hors semaine et sans date : pas dans le bloc");
  assert.equal(W.dateBesoinFR("2026-12-01"), "01/12/2026");
  assert.equal(W.dateBesoinFR(null), "—");
  assert.equal(W.quantiteArticle({ quantite: 3, unite: "m²" }), "3 m²");
  assert.equal(W.quantiteArticle({}), "");
  // Un article : singulier.
  const un = W.etatBlocMateriauxACommanderV1({ dateIso: "2026-11-27", lignes: lignes.slice(0, 1) });
  assert.equal(un.metrique, "1 article"); assert.equal(un.total, "1 article à commander · 1 chantier");
});

test("5. impossibilités visibles : chargement, erreur, date illisible, aucun article (jamais un 0 à la place d'une donnée illisible)", () => {
  const ch = W.etatBlocMateriauxACommanderV1({ dateIso: "2026-11-27", chargement: true });
  assert.equal(ch.etat, "chargement"); assert.equal(ch.metrique, "chargement…"); assert.match(ch.message, /chargement en cours/);
  const sansLignes = W.etatBlocMateriauxACommanderV1({ dateIso: "2026-11-27", lignes: null });
  assert.equal(sansLignes.etat, "chargement", "lignes absentes : jamais « aucun article »");
  const er = W.etatBlocMateriauxACommanderV1({ dateIso: "2026-11-27", erreur: "phasages : délai dépassé", lignes: [] });
  assert.equal(er.etat, "erreur"); assert.equal(er.metrique, "erreur");
  assert.equal(er.message, "Les articles à commander n'ont pas pu être lus : phasages : délai dépassé");
  const di = W.etatBlocMateriauxACommanderV1({ dateIso: "n'importe quoi", lignes: [] });
  assert.equal(di.etat, "erreur"); assert.match(di.message, /Date du jour illisible/);
  const vide = W.etatBlocMateriauxACommanderV1({ dateIso: "2026-11-27", lignes: [] });
  assert.equal(vide.etat, "aucun"); assert.equal(vide.metrique, "aucun article");
  assert.match(vide.message, /^Aucun matériau à commander pour la semaine 49 : aucun article non commandé n'a de date de besoin du 30\/11 au 06\/12\.$/);
  // Des articles existent, mais pas la semaine prochaine : toujours « aucun ».
  const ailleurs = W.etatBlocMateriauxACommanderV1({ dateIso: "2026-11-27", lignes: [ligneDate("2026-11-20", 1), ligneDate(null, 2), ligneDate("2026-12-20", 3)] });
  assert.equal(ailleurs.etat, "aucun");
  for (const e of [ch, er, vide]) { assert.ok(e.message && e.message.length > 10); assert.deepEqual(e.articles, []); }
});

test("6. statique : page et bloc passent par les mêmes fonctions ; module pur ; registre, workflow, Journal des MAJ", () => {
  const page = sansCommentaires(lire("src/Renovation/PagePlanningCommandes.jsx"));
  const bloc = sansCommentaires(lire("src/Renovation/blocsDuJour/BlocMateriauxACommander.jsx"));
  const module = sansCommentaires(lire("src/Renovation/commandesParSemaineV1.mjs"));
  const facade = lire("src/Renovation/commandesParSemaineV1.js");
  // Page : le rangement vient du module, plus de copie locale.
  assert.match(page, /import \{ addDays, semainesCommandesV1, seauxCommandesV1, ongletsCommandesV1 \} from "\.\/commandesParSemaineV1\.js";/);
  assert.match(page, /const semaines = useMemo\(\(\) => semainesCommandesV1\(new Date\(\)\), \[\]\);/, "page : horloge de l'appareil, comme avant");
  assert.match(page, /const seaux = useMemo\(\(\) => seauxCommandesV1\(lignes, semaines\), \[lignes, semaines\]\);/);
  assert.match(page, /const onglets = useMemo\(\(\) => ongletsCommandesV1\(seaux, semaines\), \[seaux, semaines\]\);/);
  assert.ok(!/function (lundiSemaine|addDays|numeroSemaine)\(/.test(page), "page : plus de copie des aides de dates");
  assert.ok(!/out\["sansdate"\]/.test(page), "page : plus de copie du rangement");
  assert.match(page, /lignes=\{lignesGlobalesACommander\}|lignesGlobalesACommander/, "page : la fenêtre reçoit lignesACommander");
  assert.match(page, /const lignesGlobalesACommander = useMemo\(\(\) => lignesACommander\(modele\), \[modele\]\);/);
  // Bloc : mêmes lectures, même liste, même rangement, date du jour du tableau de bord.
  assert.match(bloc, /import \{ chargerDonneesCommandesAPasser \} from "\.\.\/commandesAPasserDonnees\.js";/);
  assert.match(bloc, /lignesACommander\(modeleCommandesAPasser\(\{/);
  assert.match(bloc, /etatBlocMateriauxACommanderV1\(\{\s*dateIso: contexte\?\.dateIso/);
  assert.ok(!/supabase/.test(bloc), "bloc : aucun accès direct à la base");
  assert.ok(!/new Date\(/.test(bloc), "bloc : pas d'horloge, la date vient du tableau de bord");
  assert.ok(!/materiauxACommander/.test(bloc), "bloc : plus l'ancien calcul sans données (décision de Loris)");
  // Module pur : ni base, ni horloge (new Date() sans argument, Date.now), ni effet de bord.
  assert.ok(!/supabase|fetch\(|window\.|document\.|localStorage/.test(module));
  assert.ok(!/Date\.now\(|new Date\(\s*\)/.test(module), "module : aucune horloge");
  assert.match(facade, /export \* from "\.\/commandesParSemaineV1\.mjs";/);
  // Registre, workflow, journal.
  const registre = lire("src/Renovation/blocsDuJour/registre.jsx");
  assert.match(registre, /materiaux_a_commander:\s*\{[^\n]*Composant: BlocMateriauxACommander \}/);
  const wf = lire(".github/workflows/verify-organisation-jour.yml");
  assert.match(wf, /run: node scripts\/verif-bloc-materiaux-a-commander\.mjs/);
  for (const ch of ["src/Renovation/commandesParSemaineV1.mjs", "src/Renovation/commandesParSemaineV1.js", "scripts/verif-bloc-materiaux-a-commander.mjs"]) {
    assert.equal(wf.split(`'${ch}'`).length - 1, 2, `chemin surveillé (push + demande de fusion) : ${ch}`);
  }
  assert.match(lire("src/Renovation/journalMaj.js"), /titre: "Tableau de bord : le bloc « Matériaux à commander » liste les articles à commander pour la semaine prochaine"/);
  // Lien du bloc : Commandes à passer (planning-commandes), filtré par rôle.
  assert.match(lire("src/Renovation/organisationJour.mjs"), /materiaux_a_commander: \["planning-commandes"\]/);
});

test("7. même résultat sous le fuseau de Paris (heure d'été / d'hiver)", () => {
  if (process.env.VERIF_FUSEAU_PARIS) return;
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, TZ: "Europe/Paris", VERIF_FUSEAU_PARIS: "1" }, encoding: "utf8" });
  assert.equal(r.status, 0, `sous Europe/Paris :\n${r.stdout}\n${r.stderr}`);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies${process.env.VERIF_FUSEAU_PARIS ? " (fuseau Europe/Paris)" : ""} (exemple issu des tests, données fictives)`);
process.exit(echecs ? 1 : 0);
