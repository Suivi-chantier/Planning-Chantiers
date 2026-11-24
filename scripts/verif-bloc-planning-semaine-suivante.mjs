#!/usr/bin/env node
// Vérifie le bloc du jour « Planning de la semaine suivante » (projet
// docs/projets/organisation-par-jour.md, tâche 11) et l'extraction faite
// pour lui depuis la page Bilan de semaine (BilanPeriode.jsx) :
//
//   1. fenêtre : fenetreSemaineSuivanteV1(date) = ancienne expression de la
//      page fenetreSemaineProchaineV1(semaineIsoV3(date)), sur toute l'année
//      (passage d'année, semaine 53) ; date illisible → null ;
//   2. assemblage : assemblerSemaineQuiVientV1 = EXACTEMENT l'ancienne chaîne
//      de la page (recopiée ici telle qu'elle était) — découpe, référentiel,
//      fins prévisionnelles ;
//   3. noms : nomsSemaineQuiVientV1 = anciennes fonctions de la page ;
//   4. bloc : total, heures par chantier (triées, 6 max + « et N autres »),
//      heures par personne (6 max + « et N autres »), mêmes heures que les
//      lignes de la page (semaineQuiVientV3) ;
//   5. impossibilités visibles : calcul en cours, erreur du moteur (même
//      phrase que la page), semaine illisible, « aucune heure prévue la
//      semaine 49 », chantiers au-delà de l'horizon ;
//   6. la ligne « Montant prévisionnel : fonctionnalité à venir » est présente
//      dans tous les états ;
//   7. statique : la page et le bloc passent par les mêmes fonctions
//      (chargerSemaineQuiVient, fenetreSemaineSuivanteV1,
//      nomsSemaineQuiVientV1), même appel du moteur (horizon 42 jours),
//      module pur, registre branché, Journal des MAJ.
//
// Données fictives uniquement. Aucun réseau, aucune base.
//   node scripts/verif-bloc-planning-semaine-suivante.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as S from "../src/Renovation/planningSemaineSuivanteV1.mjs";
import { bilanSemaineProchaineV1, fenetreSemaineProchaineV1, ajouterJoursV1 } from "../src/Renovation/bilanSemaineProchaineV1.mjs";
import { finPrevisionnelleParChantierV1 } from "../src/Renovation/planningFinPrevisionnelleV1.mjs";
import { semaineIsoV3 } from "../src/Renovation/bilanPeriodeV3.mjs";
import { semaineQuiVientV3 } from "../src/Renovation/bilanDecisionsV3.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Jeu fictif (données inventées) ──────────────────────────────────────────
const alloc = (ch, date, res, duree) => ({ chantier_id: ch, date, resource_ids: res, duree, heures_mo: duree * res.length, texte: `Tâche ${ch}` });
const CH = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
const PERS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"];
const ALLOCS = [
  ...CH.map((c, i) => alloc(c, "2026-12-01", [PERS[i]], 7 - (i % 4))),
  alloc("C1", "2026-12-02", ["P1", "P2"], 7.5),
  alloc("C3", "2026-12-03", ["P3"], 3.25),
  alloc("C2", "2026-11-27", ["P2"], 7),   // avant la fenêtre : ignorée
  alloc("C9", "2026-12-14", ["P9"], 7),   // après la fenêtre : ignorée
];
const NON_PLANIFIES = [{ chantier_id: "C8", tache_id: "t", heures_mo_restantes: 40 }];
const REFERENTIEL = {
  chantiers: CH.concat("C9").map((id) => ({ id, nom: `CHANTIER FICTIF ${id}` })),
  ressources: PERS.map((id, i) => ({ id, nom: `Personne fictive ${id}`, nom_planning: i % 2 ? `Fictif ${id}` : null })),
};
const MOTEUR = { allocations_proposees: ALLOCS, non_planifies: NON_PLANIFIES, referentiel: REFERENTIEL };
const CHANTIERS_PAGE = [{ id: "C1", nom: "NOM DE LA PAGE C1" }];
const FEN = S.fenetreSemaineSuivanteV1("2026-11-27");

// Ancienne chaîne de BilanPeriode.jsx (avant la tâche 11), recopiée telle quelle.
function ancienneChaine(periodeFin, out, chantiers) {
  const fenetre = fenetreSemaineProchaineV1(semaineIsoV3(periodeFin));
  const etat = { decoupe: bilanSemaineProchaineV1({ resultatMoteur: out, fenetre }), referentiel: out?.referentiel || null, erreur: null,
    fins: new Map(finPrevisionnelleParChantierV1(out).chantiers.map(c => [c.chantier_id, c])) };
  const ref = etat.referentiel;
  const nomChantier = id => (chantiers || []).find(c => c.id === id)?.nom || (ref?.chantiers || []).find(c => c.id === id)?.nom || id;
  const nomRessource = id => { const r = (ref?.ressources || []).find(x => x.id === id); return r?.nom_planning || r?.nom || id; };
  return { fenetre, etat, nomChantier, nomRessource };
}

test("1. fenêtre = ancienne expression de la page, toute l'année ; date illisible → null", () => {
  assert.deepEqual(FEN, { debut: "2026-11-30", fin: "2026-12-06", jours: ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"] },
    "vendredi 27/11/2026 → semaine 49 (30/11 → 06/12)");
  for (let d = "2025-12-20"; d <= "2027-01-15"; d = ajouterJoursV1(d, 1)) {
    assert.deepEqual(S.fenetreSemaineSuivanteV1(d), fenetreSemaineProchaineV1(semaineIsoV3(d)), d);
  }
  assert.equal(S.fenetreSemaineSuivanteV1("2026-12-31").debut, "2027-01-04", "semaine 53 → semaine 1");
  assert.equal(S.fenetreSemaineSuivanteV1("2026-11-30T10:00:00").debut, "2026-12-07", "heure ignorée");
  for (const x of [null, undefined, "", "bruit", "2026-W48"]) assert.equal(S.fenetreSemaineSuivanteV1(x), null, String(x));
  assert.equal(S.HORIZON_SEMAINE_QUI_VIENT_JOURS, 42, "horizon de la page");
});

test("2. assemblerSemaineQuiVientV1 = ancienne chaîne de la page, à l'identique", () => {
  for (const out of [MOTEUR, { proposition: { allocations_proposees: ALLOCS, non_planifies: [] } }, {}, null]) {
    const ancien = ancienneChaine("2026-11-29", out, CHANTIERS_PAGE);
    const nouv = S.assemblerSemaineQuiVientV1({ resultatMoteur: out, fenetre: S.fenetreSemaineSuivanteV1("2026-11-29") });
    assert.deepEqual(nouv.decoupe, ancien.etat.decoupe);
    assert.deepEqual(nouv.referentiel, ancien.etat.referentiel);
    assert.deepEqual([...nouv.fins.entries()], [...ancien.etat.fins.entries()]);
  }
  const r = S.assemblerSemaineQuiVientV1({ resultatMoteur: MOTEUR, fenetre: FEN });
  assert.equal(r.decoupe.resume.chantiers, 8);
  assert.equal(r.decoupe.resume.allocations_hors_fenetre, 2, "allocations hors semaine écartées");
});

test("3. noms : mêmes fonctions que la page (liste de la page, référentiel, nom_planning, nom, identifiant)", () => {
  const ancien = ancienneChaine("2026-11-29", MOTEUR, CHANTIERS_PAGE);
  const n = S.nomsSemaineQuiVientV1({ chantiers: CHANTIERS_PAGE, referentiel: MOTEUR.referentiel });
  for (const id of [...CH, "C9", "INCONNU"]) assert.equal(n.nomChantier(id), ancien.nomChantier(id), id);
  for (const id of [...PERS, "INCONNU"]) assert.equal(n.nomRessource(id), ancien.nomRessource(id), id);
  assert.equal(n.nomChantier("C1"), "NOM DE LA PAGE C1");
  assert.equal(n.nomRessource("P2"), "Fictif P2");
  assert.equal(n.nomRessource("P1"), "Personne fictive P1");
  const vide = S.nomsSemaineQuiVientV1();
  assert.equal(vide.nomChantier("X"), "X");
  assert.equal(vide.nomRessource("Y"), "Y");
});

const etatOk = (moteur = MOTEUR) => {
  const r = S.assemblerSemaineQuiVientV1({ resultatMoteur: moteur, fenetre: FEN });
  const n = S.nomsSemaineQuiVientV1({ chantiers: CHANTIERS_PAGE, referentiel: r.referentiel });
  return { r, n, e: S.etatBlocPlanningSemaineSuivanteV1({ fenetre: FEN, decoupe: r.decoupe, ...n }) };
};

test("4. bloc : total, par chantier trié (6 max + et N autres), par personne (6 max + et N autres)", () => {
  const { r, n, e } = etatOk();
  assert.equal(e.etat, "ok");
  assert.equal(e.metrique, `${Math.round(r.decoupe.resume.heures_mo)} h`, "métrique clé : total d'heures prévues");
  assert.equal(e.total, `${Math.round(r.decoupe.resume.heures_mo)} h de main-d'œuvre prévues · 8 chantiers · 8 personnes`);
  assert.equal(e.chantiers.length, 6);
  assert.equal(e.autresChantiers, 2);
  assert.equal(e.personnes.length, 6);
  assert.equal(e.autresPersonnes, 2);
  const heures = e.chantiers.map((c) => c.heures);
  assert.deepEqual(heures, [...heures].sort((a, b) => b - a), "chantiers triés par heures décroissantes");
  assert.equal(e.chantiers[0].nom, "NOM DE LA PAGE C1");
  assert.equal(e.chantiers[0].texte, "22 h", "C1 : 7 h + 7,5 h × 2");
  // Mêmes heures que les lignes de la carte « La semaine qui vient » de la page.
  const page = semaineQuiVientV3({ decoupe: r.decoupe, nomChantier: n.nomChantier, nomRessource: n.nomRessource, commandes: new Map() });
  for (const c of e.chantiers) {
    const l = page.lignes.find((x) => x.titre === c.nom);
    assert.ok(l && l.detail.split(" · ").includes(c.texte), `${c.nom} : ${c.texte} sur la page`);
  }
  // Par personne : ordre et heures de bilanSemaineProchaineV1, noms de la page.
  assert.deepEqual(e.personnes.map((p) => p.id), r.decoupe.par_personne.slice(0, 6).map((p) => p.resource_id));
  assert.deepEqual(e.personnes.map((p) => p.nom), r.decoupe.par_personne.slice(0, 6).map((p) => n.nomRessource(p.resource_id)));
  assert.equal(e.personnes.find((p) => p.id === "P1").texte, "15 h", "P1 : 7 h + 7,5 h (durée sur place)");
  assert.deepEqual(e.auDelaHorizon, ["CHANTIER FICTIF C8"], "chantier qui déborde de l'horizon signalé");
  // Moins de 6 : pas de « et N autres ».
  const petit = etatOk({ allocations_proposees: [alloc("C1", "2026-12-01", ["P1"], 4.4)], non_planifies: [] }).e;
  assert.equal(petit.autresChantiers, 0);
  assert.equal(petit.autresPersonnes, 0);
  assert.equal(petit.total, "4 h de main-d'œuvre prévues · 1 chantier · 1 personne");
});

test("5. impossibilités visibles : calcul en cours, erreur (phrase de la page), semaine illisible, aucune heure", () => {
  const ch = S.etatBlocPlanningSemaineSuivanteV1({ fenetre: FEN, chargement: true });
  assert.equal(ch.etat, "chargement");
  assert.equal(ch.message, "La semaine qui vient : calcul en cours.");
  assert.equal(ch.message, semaineQuiVientV3({ decoupe: null }).indisponible, "même phrase que la page");
  const er = S.etatBlocPlanningSemaineSuivanteV1({ fenetre: FEN, erreur: "Phasages : délai dépassé" });
  assert.equal(er.etat, "erreur");
  assert.equal(er.metrique, "erreur");
  assert.equal(er.message, semaineQuiVientV3({ erreur: "Phasages : délai dépassé" }).indisponible, "même phrase que la page");
  assert.equal(er.total, null, "jamais un total à côté d'une erreur");
  const il = S.etatBlocPlanningSemaineSuivanteV1({ fenetre: null });
  assert.equal(il.etat, "erreur");
  assert.match(il.message, /Semaine illisible/);
  const vide = S.etatBlocPlanningSemaineSuivanteV1({ fenetre: FEN, decoupe: bilanSemaineProchaineV1({ resultatMoteur: { allocations_proposees: [] }, fenetre: FEN }) });
  assert.equal(vide.etat, "aucune_heure");
  assert.equal(vide.metrique, "aucune heure", "jamais « 0 h » présenté comme un chiffre");
  assert.match(vide.message, /^Aucune heure prévue la semaine 49\. Le moteur ne propose aucune intervention sur ces 7 jours\. Ce n'est pas une erreur/);
  assert.equal(vide.chantiers.length + vide.personnes.length, 0);
  const videHorizon = S.etatBlocPlanningSemaineSuivanteV1({ fenetre: FEN, decoupe: bilanSemaineProchaineV1({ resultatMoteur: { non_planifies: NON_PLANIFIES }, fenetre: FEN }) });
  assert.deepEqual(videHorizon.auDelaHorizon, ["C8"], "au-delà de l'horizon, même sans heure dans la semaine");
  assert.equal(S.etatBlocPlanningSemaineSuivanteV1().etat, "erreur", "aucun paramètre : erreur dite, pas de bloc vide");
  assert.equal(S.etatBlocPlanningSemaineSuivanteV1({ fenetre: S.fenetreSemaineSuivanteV1("2026-12-31"), decoupe: { par_chantier: [] } }).message.startsWith("Aucune heure prévue la semaine 1."), true);
  assert.equal(ch.libelleSemaine, "Semaine 49 · du lun. 30/11 au dim. 06/12");
  assert.match(ch.explication, /rien n'est enregistré, rien n'est appliqué\.$/);
});

test("6. ligne « Montant prévisionnel : fonctionnalité à venir » dans tous les états", () => {
  assert.equal(S.MESSAGE_MONTANT_PREVISIONNEL, "Montant prévisionnel : fonctionnalité à venir");
  const etats = [
    etatOk().e,
    S.etatBlocPlanningSemaineSuivanteV1({ fenetre: FEN, chargement: true }),
    S.etatBlocPlanningSemaineSuivanteV1({ fenetre: FEN, erreur: "x" }),
    S.etatBlocPlanningSemaineSuivanteV1({ fenetre: null }),
    S.etatBlocPlanningSemaineSuivanteV1({ fenetre: FEN, decoupe: { par_chantier: [] } }),
  ];
  for (const e of etats) assert.equal(e.montant, "Montant prévisionnel : fonctionnalité à venir", e.etat);
  const bloc = lire("src/Renovation/blocsDuJour/BlocPlanningSemaineSuivante.jsx");
  assert.match(bloc, /<div data-montant-previsionnel [^>]*>\{etat\.montant\}<\/div>/, "ligne affichée sans condition");
});

test("7. statique : page et bloc partagent chargement, fenêtre et noms ; moteur inchangé ; module pur ; registre", () => {
  const page = sansCommentaires(lire("src/Renovation/BilanPeriode.jsx"));
  assert.match(page, /const fenetre = fenetreSemaineSuivanteV1\(periode\.fin\);/, "page : fenêtre partagée");
  assert.match(page, /chargerSemaineQuiVient\(fenetre\)/, "page : chargement partagé");
  assert.match(page, /nomsSemaineQuiVientV1\(\{ chantiers, referentiel: semProchaine\.referentiel \}\)/, "page : noms partagés");
  assert.ok(!/simulerPlanningGlobalV1|bilanSemaineProchaineV1\(/.test(page), "page : plus d'appel direct du moteur");
  const bloc = sansCommentaires(lire("src/Renovation/blocsDuJour/BlocPlanningSemaineSuivante.jsx"));
  assert.match(bloc, /fenetreSemaineSuivanteV1\(contexte\?\.dateIso\)/, "bloc : semaine qui suit la date du jour du tableau de bord");
  assert.match(bloc, /chargerSemaineQuiVient\(fenetre\)/, "bloc : même chargement");
  assert.match(bloc, /nomsSemaineQuiVientV1\(\{ chantiers, referentiel: donnees\.valeur\?\.referentiel \|\| null \}\)/, "bloc : mêmes noms");
  assert.ok(!/supabase|simulerPlanningGlobalV1/.test(bloc), "le bloc passe par le module de lecture");
  const donnees = sansCommentaires(lire("src/Renovation/semaineQuiVientDonnees.js"));
  assert.match(donnees, /await simulerPlanningGlobalV1\(\{ startDate: fenetre\.debut, horizonDays: HORIZON_SEMAINE_QUI_VIENT_JOURS \}\)/, "même appel du moteur que la page");
  assert.match(donnees, /return assemblerSemaineQuiVientV1\(\{ resultatMoteur: out, fenetre \}\)/);
  const mod = sansCommentaires(lire("src/Renovation/planningSemaineSuivanteV1.mjs"));
  assert.ok(!/supabase|fetch\(|Date\.now|new Date\(|process\.|localStorage/.test(mod), "planningSemaineSuivanteV1.mjs : pur");
  assert.equal(lire("src/Renovation/planningSemaineSuivanteV1.js").includes('export * from "./planningSemaineSuivanteV1.mjs"'), true, "façade");
  const registre = sansCommentaires(lire("src/Renovation/blocsDuJour/registre.jsx"));
  assert.match(registre, /planning_semaine_suivante:\s*\{[^\n]*Composant: BlocPlanningSemaineSuivante \}/);
  assert.match(registre, /import BlocPlanningSemaineSuivante from "\.\/BlocPlanningSemaineSuivante";/);
  assert.match(lire("src/Renovation/journalMaj.js"), /titre: "Tableau de bord : le bloc « Planning de la semaine suivante » montre les heures prévues la semaine prochaine"/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies (exemple issu des tests, données fictives)`);
process.exit(echecs ? 1 : 0);
