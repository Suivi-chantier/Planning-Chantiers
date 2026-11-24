#!/usr/bin/env node
// Vérifie le bloc du jour « Commandes à saisir » (projet
// docs/projets/organisation-par-jour.md, tâche 7) :
//
//   1. demandes ouvrier : clé de regroupement (panier, repli « solo_ »),
//      nombre de demandes, aperçu des plus récentes (chantier, article,
//      demandeur, date), replis ;
//   2. états du bloc (règle 10) : chargement, erreur, aucune demande en
//      attente, aucun article à commander, aucun chantier — jamais un 0 quand
//      la donnée n'a pas pu être lue ;
//   3. articles à commander : statsCommandesAPasser sur le modèle de la page,
//      mêmes libellés et même format que son bandeau ;
//   4. statique : même lecture pour la tuile du tableau de bord, la page et
//      le bloc (commandesAPasserDonnees.js) ; module pur ; registre branché.
//
// Données fictives uniquement. Aucun réseau, aucune base.
//   node scripts/verif-bloc-commandes-a-saisir.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as S from "../src/Renovation/commandesASaisirV1.mjs";
import * as C from "../src/Renovation/commandesAPasserV1.mjs";
import { eur } from "../src/chantierFinance.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Jeu fictif (données inventées) ──────────────────────────────────────────
const CHANTIERS = [{ id: "ch-a", nom: "CHANTIER FICTIF A" }, { id: "ch-b", nom: "CHANTIER FICTIF B" }];
const BESOINS = [ // déjà triés par date de création décroissante, comme la lecture
  { id: "b1", panier_id: "p1", chantier_id: "ch-a", article: "Vis fictive", quantite: "2", ouvrier_demandeur: "Ouvrier 1", priorite: "urgent", created_at: "2026-11-23T09:10:00+00:00" },
  { id: "b2", panier_id: "p1", chantier_id: "ch-a", article: "Cheville fictive", quantite: null, ouvrier_demandeur: "Ouvrier 1", created_at: "2026-11-23T09:10:00+00:00" },
  { id: "b3", panier_id: null, chantier_id: "ch-inconnu", article: "  ", quantite: "", ouvrier_demandeur: "", created_at: "2026-11-20T15:00:00+00:00" },
  { id: "b4", panier_id: "p2", chantier_id: null, article: "Colle fictive", quantite: 3, ouvrier_demandeur: "Ouvrier 2", created_at: "2026-11-19T07:00:00+00:00" },
  { id: "b5", panier_id: "p2", chantier_id: "ch-b", article: "Joint fictif", ouvrier_demandeur: "Ouvrier 2", created_at: null },
  { id: "b6", panier_id: null, chantier_id: "ch-b", article: "Silicone fictif", ouvrier_demandeur: "Ouvrier 3", created_at: "2026-11-18T07:00:00+00:00" },
  { id: "b7", panier_id: "p3", chantier_id: "ch-b", article: "Mastic fictif", ouvrier_demandeur: "Ouvrier 3", created_at: "2026-11-17T07:00:00+00:00" },
];

// Modèle de la page sur un jeu fictif (même jeu que verif-commandes-a-passer).
const MATERIAUX = [
  { id: "m1", nom: "Tube fictif", unite: "m", prix_unitaire: "10" },
  { id: "m4", nom: "Plaque fictive", prix_unitaire: 5 },
];
const LOTS = [{ id: "plomb", label: "Plomberie" }];
const PHASAGES = [
  { id: "p1", chantier_id: "ch-a", ouvrages: [
    { id: "o1", libelle: "Ouvrage fictif", lot_id: "plomb", cout_materiaux: 100, taches: [{ date_prevue: "2026-11-20" }],
      materiaux_liens: [{ materiau_id: "m1", quantite: 3 }, { materiau_id: "m4" }] },
  ] },
];
const modele = (phasages = PHASAGES) => C.modeleCommandesAPasser({
  phasages, chantiers: CHANTIERS, matById: C.indexMateriaux(MATERIAUX), lotById: C.indexLots(LOTS),
  lignesCmd: [], lots: LOTS, achatsParCh: {},
});

// ═══ 1. Demandes ouvrier ════════════════════════════════════════════════════
test("1. clé de panier (repli « solo_ »), nombre de demandes", () => {
  assert.equal(S.STATUT_BESOIN_EN_ATTENTE, "en_attente");
  assert.equal(S.clePanierBesoin({ id: "x", panier_id: "p9" }), "p9");
  assert.equal(S.clePanierBesoin({ id: "x", panier_id: null }), "solo_x", "demande ancienne sans panier");
  assert.equal(S.nombreDemandesOuvriers(BESOINS), 5, "p1, solo_b3, p2, solo_b6, p3");
  assert.equal(S.nombreDemandesOuvriers([]), 0);
  assert.equal(S.nombreDemandesOuvriers(null), 0);
});

test("2. aperçu : 5 plus récentes, chantier, article, demandeur, date ; replis", () => {
  const a = S.apercuDemandesV1(BESOINS, CHANTIERS);
  assert.equal(a.length, S.NB_DEMANDES_APERCU);
  assert.deepEqual(a.map((d) => d.id), ["b1", "b2", "b3", "b4", "b5"], "ordre de la lecture conservé");
  assert.deepEqual(a[0], { id: "b1", chantier: "CHANTIER FICTIF A", article: "Vis fictive", quantite: "2", demandeur: "Ouvrier 1", date: "2026-11-23", urgent: true });
  assert.equal(a[1].quantite, null);
  assert.equal(a[2].chantier, "ch-inconnu", "chantier inconnu : identifiant, comme la page");
  assert.equal(a[2].article, "(article sans libellé)");
  assert.equal(a[2].demandeur, null);
  assert.equal(a[3].chantier, "(sans chantier)");
  assert.equal(a[3].quantite, "3");
  assert.equal(a[4].date, null, "date absente : pas de date inventée");
  assert.deepEqual(S.apercuDemandesV1([], CHANTIERS), []);
  assert.deepEqual(S.apercuDemandesV1(null, null), []);
  assert.equal(S.nomChantierBesoin({ chantier_id: "ch-b" }, CHANTIERS), "CHANTIER FICTIF B");
});

// ═══ 2. États du bloc (règle 10) ════════════════════════════════════════════
const STATS_OK = () => { const m = modele(); return { modele: m, stats: C.statsCommandesAPasser(m) }; };

test("3. chargement : aucun chiffre affiché", () => {
  const e = S.etatBlocCommandesASaisirV1({ compte: { chargement: true }, besoins: { chargement: true }, commandes: { chargement: true } });
  assert.equal(e.metrique, "…");
  assert.equal(e.demandes.etat, "chargement");
  assert.equal(e.demandes.nombre, null);
  assert.equal(e.articles.etat, "chargement");
  assert.deepEqual(e.articles.tuiles, []);
  assert.equal(S.etatBlocCommandesASaisirV1().demandes.etat, "chargement", "rien de reçu = chargement, pas 0");
});

test("4. erreurs : dites comme telles, jamais un 0", () => {
  const e = S.etatBlocCommandesASaisirV1({
    compte: { erreur: "permission refusée" }, besoins: { erreur: "x" },
    commandes: { erreur: "réseau", modele: [], stats: { nbChantiers: 0, nbACommander: 0, totalHt: 0 } },
  });
  assert.equal(e.metrique, "illisible");
  assert.equal(e.demandes.etat, "erreur");
  assert.equal(e.demandes.nombre, null);
  assert.match(e.demandes.message, /illisibles.*permission refusée.*n'est pas connu/);
  assert.equal(e.articles.etat, "erreur");
  assert.deepEqual(e.articles.tuiles, [], "erreur : aucune tuile à 0");
  assert.match(e.articles.message, /illisibles.*réseau/);
  // Nombre connu, détail illisible : le nombre reste, le détail est signalé.
  const d = S.etatBlocCommandesASaisirV1({ compte: { nombre: 4 }, besoins: { erreur: "délai" } });
  assert.equal(d.demandes.etat, "liste");
  assert.equal(d.demandes.nombre, 4);
  assert.equal(d.demandes.nbDemandes, null, "nombre de demandes inconnu, pas 0");
  assert.match(d.demandes.message, /Détail des demandes illisible/);
  assert.equal(d.metrique, "4 en attente");
});

test("5. aucune demande en attente ; aucun article à commander ; aucun chantier", () => {
  const vide = S.etatBlocCommandesASaisirV1({ compte: { nombre: 0 }, besoins: { lignes: [] }, commandes: { modele: [], stats: C.statsCommandesAPasser([]) } });
  assert.equal(vide.demandes.etat, "vide");
  assert.equal(vide.demandes.message, "Aucune demande en attente.");
  assert.equal(vide.metrique, "aucune demande");
  assert.equal(vide.articles.etat, "vide");
  assert.match(vide.articles.message, /^Aucun article à commander : aucun chantier avec des matériaux/);
  assert.deepEqual(vide.articles.tuiles, []);
  // Chantiers présents, tout commandé : tuiles (comme la page) + message.
  const m = modele([{ id: "p1", chantier_id: "ch-a", ouvrages: [{ id: "o1", lot_id: "plomb", cout_materiaux: 100, taches: [], materiaux_liens: [{ materiau_id: "m1", commande_le: "2026-11-01" }] }] }]);
  const st = C.statsCommandesAPasser(m);
  assert.equal(st.nbACommander, 0);
  const e = S.etatBlocCommandesASaisirV1({ compte: { nombre: 0 }, commandes: { modele: m, stats: st } });
  assert.equal(e.articles.etat, "vide");
  assert.equal(e.articles.message, "Aucun article à commander.");
  assert.equal(e.articles.tuiles.length, 3);
});

test("6. liste : nombre (lecture du tableau de bord), demandes, aperçu, reste", () => {
  const e = S.etatBlocCommandesASaisirV1({ compte: { nombre: 7 }, besoins: { lignes: BESOINS }, commandes: STATS_OK(), chantiers: CHANTIERS });
  assert.equal(e.metrique, "7 en attente");
  assert.equal(e.libelleNombre, "7 articles demandés");
  assert.equal(e.demandes.nombre, 7);
  assert.equal(e.demandes.nbDemandes, 5);
  assert.equal(e.demandes.apercu.length, 5);
  assert.equal(e.demandes.reste, 2);
  assert.equal(e.demandes.message, null);
  assert.equal(S.etatBlocCommandesASaisirV1({ compte: { nombre: 1 } }).libelleNombre, "1 article demandé");
});

// ═══ 3. Articles à commander : stats de la page ═════════════════════════════
test("7. tuiles = statsCommandesAPasser, mêmes libellés et format que la page", () => {
  const { modele: m, stats } = STATS_OK();
  assert.deepEqual(stats, { nbChantiers: 1, nbACommander: 2, totalHt: stats.totalHt });
  const e = S.etatBlocCommandesASaisirV1({ compte: { nombre: 0 }, commandes: { modele: m, stats } });
  assert.equal(e.articles.etat, "liste");
  assert.deepEqual(e.articles.tuiles, [
    { cle: "nbChantiers", libelle: "Chantiers en cours", valeur: "1" },
    { cle: "nbACommander", libelle: "Articles à commander", valeur: "2" },
    { cle: "totalHt", libelle: "Reste à commander HT (enveloppes des lots)", valeur: eur(stats.totalHt) },
  ]);
  const page = sansCommentaires(lire("src/Renovation/PagePlanningCommandes.jsx"));
  assert.ok(page.includes(`{ label: "${S.LIBELLES_STATS_COMMANDES.nbChantiers}", val: stats.nbChantiers,`), "libellé identique à la page");
  assert.ok(page.includes(`{ label: "${S.LIBELLES_STATS_COMMANDES.nbACommander}", val: stats.nbACommander,`));
  assert.ok(page.includes(`{ label: "${S.LIBELLES_STATS_COMMANDES.totalHt}", val: eur(stats.totalHt),`));
});

// ═══ 4. Statique : même service, module pur, registre ══════════════════════
test("8. même lecture pour la tuile du tableau de bord, la page et le bloc", () => {
  const donnees = sansCommentaires(lire("src/Renovation/commandesAPasserDonnees.js"));
  assert.match(donnees, /from\("besoins"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("statut", STATUT_BESOIN_EN_ATTENTE\)/, "compteur : même requête qu'avant");
  assert.match(donnees, /\.select\(COLONNES_BESOINS_EN_ATTENTE\)\s*\.eq\("statut", STATUT_BESOIN_EN_ATTENTE\)\s*\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(donnees, /lireToutParTranches\(/, "lignes de commande par tranches");
  assert.match(donnees, /chargerTousLesMateriaux\(COLONNES_MATERIAUX_COMMANDES\)/);
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(donnees), "lecture seule");
  assert.ok(!/"en_attente"/.test(donnees), "le filtre vient du module pur");

  const dash = sansCommentaires(lire("src/Renovation/Dashboard.jsx"));
  assert.match(dash, /compterBesoinsEnAttente\(\)\s*\.then\(\(\{ count \}\) => setCmdCount\(count \|\| 0\)\);/, "tableau de bord : même lecture, même affichage qu'avant");
  assert.ok(!/from\("besoins"\)/.test(dash), "tableau de bord : plus de lecture parallèle");

  const page = sansCommentaires(lire("src/Renovation/PagePlanningCommandes.jsx"));
  for (const f of ["lirePhasagesCommandes()", "lireLignesCommandes()", "lireBesoinsEnAttente()", "lireMateriauxCommandes()", "clePanierBesoin(b)"]) {
    assert.ok(page.includes(f), `page : ${f}`);
  }
  assert.ok(!/from\("besoins"\)\s*\.select/.test(page), "page : plus de lecture des demandes en double");
  assert.ok(!/from\("phasages"\)\s*\.select\("id, chantier_id/.test(page), "page : plus de lecture des phasages en double");
  assert.ok(!/solo_/.test(page), "page : clé de panier partagée");

  const bloc = sansCommentaires(lire("src/Renovation/blocsDuJour/BlocCommandesASaisir.jsx"));
  assert.ok(!/supabase/.test(bloc), "bloc : aucun accès direct à la base");
  for (const f of ["compterBesoinsEnAttente()", "lireBesoinsEnAttente()", "chargerDonneesCommandesAPasser()", "modeleCommandesAPasser({", "statsCommandesAPasser(modele)", "etatBlocCommandesASaisirV1({"]) {
    assert.ok(bloc.includes(f), `bloc : ${f}`);
  }
  assert.ok(!/etatMateriauxOuvrageV1|resteACommanderEnveloppes|\.reduce\(/.test(bloc), "bloc : aucun calcul réécrit");
});

test("9. module pur, façade, registre", () => {
  const mod = sansCommentaires(lire("src/Renovation/commandesASaisirV1.mjs"));
  assert.ok(!/supabase/i.test(mod), "aucun accès Supabase");
  assert.ok(!/new Date\(|Date\.now\(/.test(mod), "aucune horloge");
  assert.ok(!/from\s+"[^"]+\.js"/.test(mod), "n'importe que des .mjs");
  assert.match(lire("src/Renovation/commandesASaisirV1.js"), /export \* from "\.\/commandesASaisirV1\.mjs";/);
  const registre = sansCommentaires(lire("src/Renovation/blocsDuJour/registre.jsx"));
  assert.match(registre, /import BlocCommandesASaisir from "\.\/BlocCommandesASaisir";/);
  assert.match(registre, /commandes_a_saisir:\s*\{ icone: Package,\s*accent: "#f5a623", Composant: BlocCommandesASaisir \}/);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (e) { echecs++; console.log(`  ✗ ${nom}\n      ${e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies (exemple issu des tests, données fictives)`);
process.exit(echecs ? 1 : 0);
