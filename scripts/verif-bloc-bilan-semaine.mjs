// scripts/verif-bloc-bilan-semaine.mjs — bloc « Bilan de la semaine passée »
// du tableau de bord du jour (projet docs/projets/organisation-par-jour.md,
// tâche 6).
//
// Vérifie, sur des données de test (exemple issu des tests, données
// fictives) :
//   - la semaine passée par rapport à la date du jour (date simulée comprise) ;
//   - l'assemblage pur extrait de BilanPeriode.jsx (bornes, relevés complets
//     à relire, fusion, commandes) ;
//   - calculBilanPeriodeBaseV1 = EXACTEMENT l'ancienne chaîne de la page
//     (recopiée ici telle qu'elle était dans BilanPeriode.jsx) ;
//   - les tuiles du bandeau (libellés et explications de la page) ;
//   - les états du bloc : chargement, erreur, « aucune donnée de bilan pour
//     la semaine 47 », « relevé pas encore disponible » (jamais un 0 à la
//     place d'une donnée absente), chiffres ;
//   - statique : la page et le bloc appellent les MÊMES fonctions (même
//     chiffre = même service), module pur sans Supabase ni horloge.
// Lancement : node scripts/verif-bloc-bilan-semaine.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as S from "../src/Renovation/bilanSemaineChiffresV1.mjs";
import * as B from "../src/Renovation/bilanPeriodeV3.mjs";
import { alertesMargesV2 } from "../src/Renovation/alertesMargesV2.mjs";
import { estChantierActif } from "../src/Renovation/chantierActif.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const sansCommentaires = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Données de test (exemple issu des tests, données fictives) ──────────────
const rel = (id, date, o = {}) => ({
  chantier_id: id, chantier_nom: id.toUpperCase(), date_releve: date, avancement: 50,
  vendu_ht: 20000, heures_vendues: 200, heures_reelles: 100, production_cumulee: 10000, marge_avancement: 1000,
  marge_terminaison: 2000, marge_probable: 1500, budget_restant: 6000, chantier_repris: false,
  statut_completude: "complete", cr_manquants: [], mat_prev: 5000, mo_prev: 8000, ...o,
});
const CHANTIERS = [
  { id: "c1", nom: "CHANTIER UN" }, { id: "c2", nom: "CHANTIER DEUX" }, { id: "c3", nom: "DÉPOT" },
  { id: "c4", nom: "ÉTUDE", statut: "a_l_etude" }, { id: "c5", nom: "CHANTIER CALME" },
];
const P47 = B.periodeSemaineV3("2026-W47");
const donneesW47 = () => {
  const pointages = [
    { chantier_id: "c1", date: "2026-11-13", heures: 7, ouvrier: "A" },
    { chantier_id: "c1", date: "2026-11-17", heures: 8, ouvrier: "A" },
    { chantier_id: "c2", date: "2026-11-19", heures: 6, ouvrier: "B" },
    { chantier_id: "c3", date: "2026-11-18", heures: 4, ouvrier: "C" },
  ];
  const releves = [
    rel("c1", "2026-11-13"),
    rel("c1", "2026-11-20", { avancement: 60, production_cumulee: 12500, marge_avancement: 1300, heures_reelles: 130, marge_probable: 1200 }),
    rel("c2", "2026-11-13", { vendu_ht: 8000, production_cumulee: 3000, marge_avancement: 400, heures_reelles: 30, marge_probable: 900 }),
    rel("c2", "2026-11-20", { vendu_ht: 8000, production_cumulee: 3600, marge_avancement: 300, heures_reelles: 48, marge_probable: 700, statut_completude: "incomplete", cr_manquants: ["B"] }),
    rel("c5", "2026-11-13"),
  ];
  const rapports = [
    { id: 1, ouvrier: "A", chantier_id: "c1", date_rapport: "17/11/2026", statut: "valide", semaine: "2026-W47" },
    { id: 2, ouvrier: "B", chantier_id: "c2", date_rapport: "19/11/2026", statut: "soumis", semaine: "2026-W47" },
  ];
  const bornes = S.bornesDonneesPeriodeV1(P47, pointages);
  return { erreur: null, bornes, releves, pointages, rapports, journal: [], commandes: S.commandesDePeriodeV1([{ chantier_id: "c5", commandes: { date_doc: "2026-10-01" } }]) };
};

// Ancienne chaîne de BilanPeriode.jsx (avant la tâche 6), recopiée telle quelle.
function ancienneChainePage({ periode, donnees, chantiers, choixPeriode = {}, reglages = {} }) {
  const enCours = (chantiers || [])
    .filter(c => estChantierActif(c) && !["DÉPOT"].includes(c.nom))
    .sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr"));
  const { bornes, releves, pointages, rapports, journal, commandes } = donnees;
  const activite = B.activiteChantiersV3({ periode, pointages, rapports, journal, commandes });
  const preselection = B.preselectionChantiersV3({ chantiers: enCours, activite, choix: choixPeriode });
  const retenus = preselection.filter(p => p.coche).map(p => ({ id: p.chantierId, nom: p.nom }));
  const idx = B.indexerRelevesV3(releves);
  const pick = d => retenus.map(c => B.releveAuPlusTardV3(idx.get(c.id), d)).filter(Boolean);
  const alertes = alertesMargesV2({ snapshotsCourants: pick(bornes.dateFin), snapshotsPrecedents: pick(bornes.dateDepart), seuils: reglages.seuilsMarges });
  const alertesParChantier = Object.fromEntries(alertes.lignes.map(l => [l.chantier_id, l.alertes.map(a => ({ ...a, motif: a.motif }))]));
  const synthese = B.syntheseChantiersV3({ releves: idx, chantiers: retenus, bornes, periode, alertesParChantier,
    seuilBaisse: reglages.seuilsMarges?.alerteBaisseMargeProbableEuros ?? 500, baremeFG: reglages.baremeFG, seuils: reglages.seuilsMarges });
  const noms = Object.fromEntries(enCours.map(c => [c.id, c.nom]));
  const avertissements = B.avertissementsExportV3({ periode, chantierIds: retenus.map(c => c.id), rapports, relevesLignes: releves, noms });
  const bandeau = B.bandeauV3({ synthese, nbComptesRendusNonValides: avertissements.nbNonValides });
  return { enCours, activite, preselection, retenus, alertes, synthese, avertissements, bandeau };
}

// ═══════════════════════════════════════════════════════════════════════════
test("1. semaine passée par rapport à la date du jour (date simulée comprise)", () => {
  assert.equal(S.semainePasseeV1("2026-11-24"), "2026-W47");
  assert.equal(S.semainePasseeV1("2026-11-23"), "2026-W47", "lundi");
  assert.equal(S.semainePasseeV1("2026-11-29"), "2026-W47", "dimanche");
  assert.equal(S.semainePasseeV1("2026-11-30"), "2026-W48");
  assert.equal(S.semainePasseeV1("2027-01-05"), "2026-W53", "passage d'année (2026 compte 53 semaines)");
  assert.equal(S.semainePasseeV1("2026-01-06"), "2026-W01");
  assert.equal(S.semainePasseeV1(""), null);
  assert.equal(S.semainePasseeV1(null), null);
});

test("2. assemblage pur : bornes, relevés complets à relire, fusion, commandes", () => {
  const d = donneesW47();
  assert.equal(d.bornes.dateDepart, "2026-11-13", "départ : fin de la semaine précédente (vendredi)");
  assert.equal(d.bornes.dateFin, "2026-11-20", "fin : vendredi de la semaine");
  // Pointage à 0 h : pas un jour travaillé.
  assert.deepEqual(S.bornesDonneesPeriodeV1(P47, [{ date: "2026-11-21", heures: 0 }]), B.bornesComparaisonV3(P47, []));
  const besoins = S.relevesCompletsAChargerV1(d.releves, d.bornes);
  assert.deepEqual(besoins, [["2026-11-20", ["c1", "c2"]], ["2026-11-13", ["c1", "c2", "c5"]]]);
  const complet = { ...rel("c1", "2026-11-20"), lots: [{ id: "l1" }] };
  const fusion = S.fusionnerRelevesCompletsV1(d.releves, [complet]);
  assert.equal(fusion.length, d.releves.length);
  assert.equal(fusion[1], complet, "relevé complet substitué au relevé léger");
  assert.equal(fusion[0], d.releves[0], "les autres relevés restent les légers");
  assert.deepEqual(S.commandesDePeriodeV1([{ chantier_id: "x", commandes: { date_doc: "2026-11-18" } }, { chantier_id: "y", commandes: null }]),
    [{ chantier_id: "x", date: "2026-11-18" }, { chantier_id: "y", date: undefined }]);
  assert.deepEqual(S.commandesDePeriodeV1(null), []);
});

test("3. calculBilanPeriodeBaseV1 = ancienne chaîne de la page, à l'identique", () => {
  const d = donneesW47();
  const reglagesVariantes = [{}, { seuilsMarges: { alerteBaisseMargeProbableEuros: 100 }, baremeFG: [{ depuis: "2020-01-01", taux: 12 }] }];
  for (const reglages of reglagesVariantes) {
    for (const choix of [{}, { c5: true }, { c1: false }]) {
      const ref = ancienneChainePage({ periode: P47, donnees: d, chantiers: CHANTIERS, choixPeriode: choix, reglages });
      const enCours = S.chantiersEnCoursBilanV1(CHANTIERS);
      assert.deepEqual(enCours, ref.enCours);
      const nouv = S.calculBilanPeriodeBaseV1({ periode: P47, donnees: d, enCours, choix, reglages });
      for (const k of ["preselection", "retenus", "alertes", "synthese", "avertissements", "bandeau"]) {
        assert.deepEqual(nouv[k], ref[k], `${k} (choix ${JSON.stringify(choix)})`);
      }
      assert.deepEqual([...nouv.activite], [...ref.activite]);
    }
  }
  const b = S.calculBilanPeriodeBaseV1({ periode: P47, donnees: d, enCours: S.chantiersEnCoursBilanV1(CHANTIERS) }).bandeau;
  assert.equal(b.production, 3100, "2 500 + 600 (données fictives)");
  assert.equal(b.margePeriode, 200, "300 − 100");
  assert.equal(b.heuresValidees, 48, "30 + 18");
  assert.equal(b.nbComptesRendusNonValides, 1);
  assert.deepEqual(S.chantiersEnCoursBilanV1(CHANTIERS).map(c => c.id), ["c5", "c2", "c1"], "hors DÉPOT et chantiers à l'étude, triés par nom");
});

test("4. tuiles du bandeau : libellés et explications de la page", () => {
  const d = donneesW47();
  const b = S.calculBilanPeriodeBaseV1({ periode: P47, donnees: d, enCours: S.chantiersEnCoursBilanV1(CHANTIERS) }).bandeau;
  const t = S.tuilesBandeauBilanV1(b);
  assert.deepEqual(t.map(x => x.libelle), ["Production de la période", "Marge de la période", "Marge probable, tous chantiers", "Heures validées", "Comptes rendus non validés"]);
  const par = Object.fromEntries(t.map(x => [x.cle, x]));
  assert.equal(par.production.valeur, `${(3100).toLocaleString("fr-FR")} €`);
  assert.equal(par.marge_periode.valeur, "+200 €");
  assert.equal(par.marge_periode.sous[0], "6 % de la production");
  assert.equal(par.heures.valeur, "48 h");
  assert.equal(par.comptes_rendus.valeur, "1");
  assert.equal(par.comptes_rendus.ton, "alerte");
  // Ancien tableau construit dans BilanPeriode.jsx, recopié tel quel : mêmes libellés, valeurs, explications.
  const ancien = (b) => {
    const fmtEur = v => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} €`);
    const fmtEurSigne = v => (v == null ? "—" : `${v > 0.5 ? "+" : v < -0.5 ? "−" : ""}${Math.round(Math.abs(v)).toLocaleString("fr-FR")} €`);
    const fmtH = v => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")} h`);
    const fmtPctSur = v => { if (v == null) return "—"; const r = Math.round(v); return `${r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("fr-FR")} %`; };
    const fmtEurH = v => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} €/h`);
    const fleche = v => (v == null || Math.abs(v) < 1 ? "=" : v < 0 ? "▼" : "▲");
    return [
      ["Production de la période", fmtEur(b.production), []],
      ["Marge de la période", fmtEurSigne(b.margePeriode), [`${fmtPctSur(b.margePeriodePct)} de la production`]],
      [b.nbChantiersHorsComparaison > 0 ? `Marge probable (${B.nbChantiersV3(b.nbChantiersComparables)})` : "Marge probable, tous chantiers",
        fmtEurSigne(b.margeProbableTotale), [
        `${fmtPctSur(b.margeProbableTotalePct)} du vendu · devis ${fmtEurSigne(b.margeDevisTotale)} (${fmtPctSur(b.margeDevisTotalePct)})`,
        b.evolutionMargeProbable == null ? "évolution sur la période : —" : `${fleche(b.evolutionMargeProbable)} ${fmtEurSigne(b.evolutionMargeProbable)} sur la période, tous chantiers`,
        ...(b.nbChantiersHorsComparaison > 0 ? [`${b.nbChantiersHorsComparaison} chantier(s) hors total : marge devis inconnue ou sans matériaux prévus`] : [])]],
      ["Heures validées", fmtH(b.heuresValidees), [`${fmtEurH(b.eurParHeure)} produits · devis ${fmtEurH(b.eurParHeureDevis)}`]],
      ...(b.nbComptesRendusNonValides ? [["Comptes rendus non validés", String(b.nbComptesRendusNonValides), []]] : []),
    ];
  };
  for (const bb of [b, { ...b, nbChantiersHorsComparaison: 2, nbChantiersComparables: 3, evolutionMargeProbable: -812.6 }, B.bandeauV3({ synthese: [] })]) {
    assert.deepEqual(S.tuilesBandeauBilanV1(bb).map(x => [x.libelle, x.valeur, x.sous]), ancien(bb));
  }
  // Sans compte rendu non validé : pas de tuile (comme la page).
  assert.ok(!S.tuilesBandeauBilanV1({ ...b, nbComptesRendusNonValides: 0 }).some(x => x.cle === "comptes_rendus"));
  // Donnée absente : « — », jamais 0.
  const vide = S.tuilesBandeauBilanV1(B.bandeauV3({ synthese: [] }));
  assert.ok(vide.every(x => !/^[+−]?0( €| h)?$/.test(x.valeur)), vide.map(x => x.valeur).join(" | "));
  assert.deepEqual(vide.map(x => x.valeur), ["—", "—", "—", "—"]);
  // Formats identiques à ceux de la page avant extraction.
  assert.equal(S.fmtEurSigneBilan(-1234.4), `−${(1234).toLocaleString("fr-FR")} €`);
  assert.equal(S.fmtEurSigneBilan(0.2), "0 €");
  assert.equal(S.fmtHBilan(12.25), `${(12.3).toLocaleString("fr-FR")} h`);
  assert.equal(S.fmtPctSurBilan(-4.6), "−5 %");
  assert.equal(S.fmtEurHBilan(null), "—");
  assert.deepEqual([S.flecheBilan(null), S.flecheBilan(0.5), S.flecheBilan(-3), S.flecheBilan(3)], ["=", "=", "▼", "▲"]);
});

test("5. états du bloc : chargement, erreur, aucune donnée, relevé absent, chiffres", () => {
  const enCours = S.chantiersEnCoursBilanV1(CHANTIERS);
  // Chargement.
  const ch = S.etatBlocBilanSemaineV1({ weekId: "2026-W47", chargement: true });
  assert.equal(ch.etat, "chargement");
  assert.equal(ch.metrique, "chargement…");
  assert.deepEqual(ch.tuiles, []);
  // Erreur : message explicite, aucun chiffre.
  const er = S.etatBlocBilanSemaineV1({ weekId: "2026-W47", erreur: "permission denied" });
  assert.equal(er.etat, "erreur");
  assert.match(er.message, /Le bilan de la semaine 47 n'a pas pu être chargé \(permission denied\)/);
  assert.deepEqual(er.tuiles, []);
  assert.equal(S.etatBlocBilanSemaineV1({ weekId: "n'importe quoi" }).etat, "erreur");
  // Aucune donnée : aucun chantier en cours n'a d'activité sur la semaine.
  const d0 = { erreur: null, bornes: S.bornesDonneesPeriodeV1(P47, []), releves: [rel("c1", "2026-11-06")], pointages: [], rapports: [], journal: [], commandes: [] };
  const base0 = S.calculBilanPeriodeBaseV1({ periode: P47, donnees: d0, enCours });
  const v = S.etatBlocBilanSemaineV1({ weekId: "2026-W47", base: base0 });
  assert.equal(v.etat, "aucune_donnee");
  assert.match(v.message, /^Aucune donnée de bilan pour la semaine 47/);
  assert.equal(v.metrique, "aucune donnée");
  assert.deepEqual(v.tuiles, [], "aucun chiffre affiché (jamais 0)");
  // Relevé absent : activité, mais aucun relevé à la fin de la semaine.
  const d = donneesW47();
  const dSans = { ...d, releves: [] };
  const baseSans = S.calculBilanPeriodeBaseV1({ periode: P47, donnees: dSans, enCours });
  const r = S.etatBlocBilanSemaineV1({ weekId: "2026-W47", base: baseSans });
  assert.equal(r.etat, "releve_absent");
  assert.match(r.message, /^Relevé pas encore disponible pour la semaine 47 : chiffres inconnus \(2 chantiers avec activité\)\.$/);
  assert.equal(r.metrique, "relevé à venir");
  const valeurs = r.tuiles.filter(t => t.cle !== "comptes_rendus").map(t => t.valeur);
  assert.deepEqual(valeurs, ["—", "—", "—", "—"], "données absentes : « — », jamais 0");
  // Chiffres : métrique de l'en-tête = heures validées.
  const base = S.calculBilanPeriodeBaseV1({ periode: P47, donnees: d, enCours });
  const ok = S.etatBlocBilanSemaineV1({ weekId: "2026-W47", base });
  assert.equal(ok.etat, "ok");
  assert.equal(ok.metrique, "48 h");
  assert.equal(ok.message, null);
  assert.ok(ok.tuiles.length >= 3 && ok.tuiles.length <= 5, "3 à 5 chiffres clés");
  assert.equal(ok.libelleSemaine, "Semaine 47 (16/11 → 22/11/2026)");
  assert.equal(ok.note, "2 chantiers avec activité");
  // Relevé absent pour une partie des chantiers : dit, pas masqué.
  const dPartiel = { ...d, releves: d.releves.filter(x => x.chantier_id !== "c2") };
  const p = S.etatBlocBilanSemaineV1({ weekId: "2026-W47", base: S.calculBilanPeriodeBaseV1({ periode: P47, donnees: dPartiel, enCours }) });
  assert.equal(p.etat, "ok");
  assert.match(p.note, /relevé pas encore disponible pour 1 chantier/);
  // Aucun compte rendu non validé : dit explicitement.
  const dValides = { ...d, rapports: d.rapports.map(x => ({ ...x, statut: "valide" })) };
  const q = S.etatBlocBilanSemaineV1({ weekId: "2026-W47", base: S.calculBilanPeriodeBaseV1({ periode: P47, donnees: dValides, enCours }) });
  assert.match(q.note, /aucun compte rendu non validé/);
});

test("6. statique : même service pour la page et le bloc ; module pur", () => {
  const mod = sansCommentaires(lire("src/Renovation/bilanSemaineChiffresV1.mjs"));
  assert.ok(!/supabase/i.test(mod), "module pur : aucun accès Supabase");
  assert.ok(!/new Date\(|Date\.now\(/.test(mod), "module pur : aucune horloge");
  assert.ok(!/from\s+"[^"]+\.js"/.test(mod), "module pur : n'importe que des .mjs");
  assert.match(lire("src/Renovation/bilanSemaineChiffresV1.js"), /export \* from "\.\/bilanSemaineChiffresV1\.mjs";/, "façade .js");
  const page = sansCommentaires(lire("src/Renovation/BilanPeriode.jsx"));
  assert.match(page, /chargerDonneesBilanPeriode\(periode, \{ estAnnule: \(\) => annule \}\)/, "page : chargement partagé");
  assert.match(page, /calculBilanPeriodeBaseV1\(\{ periode, donnees, enCours, choix: choixPeriode, reglages \}\)/, "page : calcul partagé");
  assert.match(page, /tuilesBandeauBilanV1\(calcul\.bandeau\)/, "page : tuiles partagées");
  assert.match(page, /chantiersEnCoursBilanV1\(chantiers\)/);
  assert.ok(!/chantier_releves_journaliers"\)\.select\(COLONNES_LEGERES\)/.test(page), "page : plus de chargement parallèle");
  assert.ok(!/bandeauV3\(|syntheseChantiersV3\(|avertissementsExportV3\(/.test(page), "page : aucun recalcul en double");
  const bloc = sansCommentaires(lire("src/Renovation/blocsDuJour/BlocBilanSemainePassee.jsx"));
  assert.match(bloc, /chargerDonneesBilanPeriode\(periode, \{ estAnnule: \(\) => annule \}\)/, "bloc : même chargement");
  assert.match(bloc, /calculBilanPeriodeBaseV1\(\{ periode, donnees: donnees\.valeur, enCours, choix: \{\}, reglages \}\)/, "bloc : même calcul, présélection par défaut");
  assert.match(bloc, /semainePasseeV1\(contexte\?\.dateIso\)/, "bloc : semaine passée par rapport à la date du jour");
  assert.match(bloc, /etatBlocBilanSemaineV1\(/);
  assert.match(bloc, /useReglagesMarges\(\)/, "bloc : mêmes réglages des marges que la page");
  assert.ok(!/supabase/.test(bloc), "bloc : aucun accès direct à la base");
  assert.ok(!/bandeauV3\(|syntheseChantiersV3\(|production_cumulee|marge_avancement/.test(bloc), "bloc : aucun calcul réécrit");
  const registre = sansCommentaires(lire("src/Renovation/blocsDuJour/registre.jsx"));
  assert.match(registre, /bilan_semaine_passee:\s*\{ icone: ChartBar,\s*accent: "#5b8af5", Composant: BlocBilanSemainePassee \}/, "registre : bloc branché");
  const donnees = sansCommentaires(lire("src/Renovation/bilanSemaineDonnees.js"));
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(donnees), "chargement : lecture seule");
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies (exemple issu des tests, données fictives)`);
process.exit(echecs ? 1 : 0);
