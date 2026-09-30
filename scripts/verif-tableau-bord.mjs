// scripts/verif-tableau-bord.mjs — Vérification du tableau de bord Invest,
// écran et mail du matin.
//
// Pourquoi ce script
// ──────────────────
// Le mail de 7h est le seul morceau du produit qu'on ne peut pas vérifier en
// cliquant : il part sans témoin, et une erreur y prend la forme la plus
// trompeuse qui soit — un tableau de bord vide, qui rassure. « Rien à faire
// aujourd'hui » et « la requête a échoué » se ressemblent trop.
//
// Ce qu'il éprouve :
//   1. le moteur partagé (src/Invest/tableauBord.mjs) sur des cas nommés ;
//   2. la dépendance au lecteur — « délégué » veut dire « pas à moi » ;
//   3. le mail lui-même : contenu, plafonds annoncés, échappement HTML ;
//   4. les liens profonds, contre les clés que PageInvest.jsx sait vraiment lire ;
//   5. le cron de bout en bout, contre un faux Supabase et un faux envoyeur ;
//   6. l'absence de seconde définition de la logique dans Dashboard.jsx.
//
// Usage :  node scripts/verif-tableau-bord.mjs
//
// Aucune dépendance, aucune base, aucun réseau, aucun mail expédié.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import {
  consolidateData, repartirEnColonnes, routineDepuisLignes, planFromRoutine,
  REQUETES_TABLEAU_BORD, chargerTableauBord, V9_COLONNES, safeDate,
} from "../src/Invest/tableauBord.mjs";

const {
  runInvestTableauBord, buildTableauBordHtml, lienDossier,
  TAILLE_MAX_OCTETS, PARTS,
} = require("../api/_cron/cron-invest-tableau-bord.js");
const { destinatairesTableauBord } = require("../api/_cron/_destinataires-invest.js");

// ── Harnais ─────────────────────────────────────────────────────────────────
let passes = 0, echecs = 0;
function verifie(nom, condition, detail = "") {
  if (condition) { passes++; console.log(`  ✓ ${nom}`); }
  else { echecs++; console.log(`  ✗ ${nom}${detail ? `\n      ${detail}` : ""}`); }
}
function section(titre) { console.log(`\n${titre}\n${"─".repeat(titre.length)}`); }

// ── Faux client Supabase ────────────────────────────────────────────────────
//
// Surface réellement utilisée : .select() enchaînable avec .eq / .lt / .order /
// .limit, .maybeSingle(), .upsert(), et l'attente directe du builder. Le
// filtrage est appliqué pour de bon — un faux qui ne filtre pas laisserait
// passer une erreur de fenêtre de dates, qui est justement le risque.
function fauxSupabase(tables, journal = {}) {
  const filtrer = (rows, filtres) => rows.filter(r => filtres.every(f => {
    const v = r[f.col];
    if (f.op === "eq")  return v === f.val;
    if (f.op === "lt")  return v != null && String(v) <  String(f.val);
    if (f.op === "lte") return v != null && String(v) <= String(f.val);
    if (f.op === "in")  return f.val.includes(v);
    if (f.op === "is")  return f.val === null ? (v === null || v === undefined) : v === f.val;
    if (f.op === "notIsNull") return v !== null && v !== undefined;
    return true;
  }));

  return {
    from(table) {
      const filtres = [];
      const rows = tables[table];
      let tri = null, plafond = null;
      const builder = {
        select() { return builder; },
        eq(col, val)  { filtres.push({ col, val, op: "eq" });  return builder; },
        lt(col, val)  { filtres.push({ col, val, op: "lt" });  return builder; },
        lte(col, val) { filtres.push({ col, val, op: "lte" }); return builder; },
        in(col, val)  { filtres.push({ col, val, op: "in" });  return builder; },
        is(col, val)  { filtres.push({ col, val, op: "is" });  return builder; },
        not(col, op, val) { if (op === "is" && val === null) filtres.push({ col, op: "notIsNull" }); return builder; },
        order(col, opts) { tri = { col, asc: opts?.ascending !== false }; return builder; },
        limit(n) { plafond = n; return builder; },
        update(patch) {
          const cible = { table, patch, filtres: [...filtres] };
          (journal.updates ||= []).push(cible);
          const suite = {
            eq(col, val) { cible.filtres.push({ col, val, op: "eq" }); return suite; },
            then(res, rej) { return Promise.resolve({ error: null }).then(res, rej); },
          };
          return suite;
        },
        upsert(valeur) { (journal.upserts ||= []).push({ table, valeur }); return Promise.resolve({ error: null }); },
        maybeSingle() {
          if (rows === undefined) return Promise.resolve({ data: null, error: { code: "42P01", message: "table absente" } });
          return Promise.resolve({ data: filtrer(rows, filtres)[0] || null, error: null });
        },
        then(resolve, reject) {
          if (rows === undefined) {
            return Promise.resolve({ data: null, error: { code: "42P01", message: "table absente" } }).then(resolve, reject);
          }
          let out = filtrer(rows, filtres);
          if (tri) out = [...out].sort((a, b) => (tri.asc ? 1 : -1) * String(a[tri.col] ?? "").localeCompare(String(b[tri.col] ?? "")));
          if (plafond != null) out = out.slice(0, plafond);
          return Promise.resolve({ data: out, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}
const fauxMailer = (boite) => async (_req, to, subject, html) => { boite.push({ to, subject, html }); return { ok: true }; };

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// Les dates sont calculées à partir du jour courant, jamais écrites en dur.
// Le moteur du tableau de bord compare ses échéances à l'horloge du processus
// (voir la note « Notion d'aujourd'hui » dans tableauBord.mjs) : une fixture
// figée au 20/08/2026 vieillirait, un « à venir » deviendrait « en retard », et
// la suite se mettrait à échouer sans qu'aucun code ait changé.
const iso = (d) => d.toISOString().slice(0, 10);
const decale = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const dateFrDe = (isoJour) => new Date(isoJour).toLocaleDateString("fr-FR");

const AUJ = decale(0);
const HIER = decale(-1);
const t = { dateIso: AUJ, dateFr: dateFrDe(AUJ), weekday: "Jeudi", hour: 7 };

const UTILISATEURS = [
  { id: "u1", nom: "Matthieu Fumoleau", email: "matthieu.fumoleau@groupe-profero.com", role: "admin",      branches: ["invest", "renovation"], actif: true },
  { id: "u2", nom: "Camille Landais",   email: "camille.landais@groupe-profero.com",   role: "commercial", branches: ["invest"], actif: true },
  { id: "u3", nom: "Tom Fourmond",      email: "tom.fourmond@groupe-profero.com",      role: "direction",  branches: ["invest"], actif: true },
  { id: "u4", nom: "Ancien Parti",      email: "ancien@groupe-profero.com",            role: "admin",      branches: ["invest"], actif: false },
];

const PROFIL_MATTHIEU = { nom: "Matthieu Fumoleau", email: "matthieu.fumoleau@groupe-profero.com" };
const PROFIL_CAMILLE  = { nom: "Camille Landais",   email: "camille.landais@groupe-profero.com" };

// Un client à moi, en retard : l'archétype du « à décider maintenant ».
const CLIENT_RETARD = {
  id: "c1", prenom: "Léa", nom: "Bertin", etape: "Financement", statut: "actif",
  conseiller: "Matthieu Fumoleau", budget: 250000,
  prochaine_action: "Relancer la banque", date_prochaine_action: decale(-10),
  updated_at: decale(-1),
};
// Un client confié à Camille, à échéance FUTURE — donc sans urgence. C'est le
// seul cas où le classement diffère selon le lecteur : un dossier urgent, lui,
// remonte en « à décider » chez tout le monde (voir section 1).
const CLIENT_CAMILLE = {
  id: "c2", prenom: "Marc", nom: "Ozanne", etape: "Compromis", statut: "actif",
  conseiller: "Camille Landais", budget: 180000,
  prochaine_action: "Relancer le notaire", date_prochaine_action: decale(3),
  updated_at: decale(0),
};
// Un bien sans conseiller : le repli doit être celui qui pilote, pas un prénom
// codé en dur — sinon ce bien sort de MA colonne « à décider ».
const BIEN_SANS_CONSEILLER = {
  id: "b1", reference_interne: "NANTES-014", adresse: "12 rue des Olivettes",
  ville: "Nantes", statut: "Offre à faire", prix_vente: 210000,
};

// Tranche 2b : l'avancement vient du Dossier Invest. Chaque client a un dossier
// en cours et une étape active qui porte balle, prochaine action et échéance
// (les champs etape / prochaine_action du client ne sont plus lus).
const dossierDe = (client, { etape, balleUid, action, echeance, maj }) => ({
  dossier: { id: `d-${client.id}`, client_id: client.id, reference: `INV-T-${client.id}`, libelle: "Dossier", statut: "actif", conseiller_id: balleUid },
  etape: { id: `e-${client.id}`, dossier_id: `d-${client.id}`, operation_id: null, etape, statut: "en_cours", balle: "profero",
    balle_utilisateur_id: balleUid, balle_tiers_libelle: null, prochaine_action: action, echeance, blocage_motif: null,
    bloquee_depuis: null, reprise_a_confirmer: false, updated_at: maj },
});
const DOSSIER_RETARD = dossierDe(CLIENT_RETARD, { etape: "financement", balleUid: "u1", action: "Relancer la banque", echeance: decale(-10), maj: decale(-1) });
const DOSSIER_CAMILLE = dossierDe(CLIENT_CAMILLE, { etape: "acquisition", balleUid: "u2", action: "Relancer le notaire", echeance: decale(3), maj: decale(0) });

const DONNEES = {
  clients: [CLIENT_RETARD, CLIENT_CAMILLE],
  crmProspects: [], biens: [BIEN_SANS_CONSEILLER], propositions: [], planning: [], actions: [],
  dossiersInvest: [DOSSIER_RETARD.dossier, DOSSIER_CAMILLE.dossier],
  etapesInvest: [DOSSIER_RETARD.etape, DOSSIER_CAMILLE.etape],
  utilisateurs: UTILISATEURS,
};

// ════════════════════════════════════════════════════════════════════════════
section("1. Le classement dépend de qui regarde");

const vuMatthieu = consolidateData({ ...DONNEES, profil: PROFIL_MATTHIEU, pilote: "Matthieu Fumoleau" });
const vuCamille  = consolidateData({ ...DONNEES, profil: PROFIL_CAMILLE,  pilote: "Camille Landais" });

const catDe = (data, cle) => data.allDossiers.find(d => d.key === cle)?.category;

verifie("mon client en retard est à décider chez moi",
  catDe(vuMatthieu, "client_c1") === "decision", catDe(vuMatthieu, "client_c1"));

// L'urgence passe avant la délégation, et c'est voulu : un dossier en retard
// remonte en « à décider » chez tout le monde. Sans quoi une échéance dépassée
// pourrait dormir dans la colonne « délégué » de trois personnes à la fois,
// chacune la croyant portée par une autre.
verifie("un dossier urgent reste à décider, même chez qui ne le porte pas",
  catDe(vuCamille, "client_c1") === "decision", catDe(vuCamille, "client_c1"));

// La délégation ne départage donc que les dossiers sans urgence — c'est là que
// le tableau de bord dépend réellement de qui le regarde.
verifie("un dossier à échéance future confié à un tiers est délégué chez moi",
  catDe(vuMatthieu, "client_c2") === "delegated", catDe(vuMatthieu, "client_c2"));
verifie("le même est simplement à surveiller chez celle qui le porte",
  catDe(vuCamille, "client_c2") === "watch", catDe(vuCamille, "client_c2"));

// Le repli du responsable d'un bien : la valeur était « Benjamin » en dur, ce
// qui faisait passer tout bien non attribué pour délégué, chez tout le monde.
verifie("un bien sans conseiller revient à qui pilote",
  vuMatthieu.allDossiers.find(d => d.key === "bien_b1")?.responsable === "Matthieu Fumoleau",
  vuMatthieu.allDossiers.find(d => d.key === "bien_b1")?.responsable);
verifie("et il reste dans sa colonne à décider, pas en délégué",
  catDe(vuMatthieu, "bien_b1") === "decision", catDe(vuMatthieu, "bien_b1"));

// ════════════════════════════════════════════════════════════════════════════
section("2. Un arbitrage rendu fait sortir le dossier du flux");

const routineVide = routineDepuisLignes([]);
const colVide = repartirEnColonnes({ dossiers: vuMatthieu.allDossiers, routine: routineVide, filtre: "all" });
verifie("sans arbitrage, le client en retard est dans « à décider »",
  colVide.decision.some(d => d.key === "client_c1"));

const routineArbitree = routineDepuisLignes([
  { step_key: "pilotage_dossier", item_type: "client", item_id: "c1", item_label: "Léa Bertin",
    decision: "Relancer banque", responsable: "Matthieu Fumoleau", next_action: "Appeler le courtier",
    due_date: AUJ, comment: "Dossier bloqué sur l'assurance", created_at: `${AUJ}T06:50:00Z` },
]);
const colArbitree = repartirEnColonnes({ dossiers: vuMatthieu.allDossiers, routine: routineArbitree, filtre: "all" });
verifie("arbitré à 6h50, il n'est plus annoncé « à décider » à 7h",
  !colArbitree.decision.some(d => d.key === "client_c1"));
verifie("il apparaît dans « traité »",
  colArbitree.done.some(d => d.key === "client_c1"));
verifie("l'action décidée nourrit le plan d'action",
  planFromRoutine(routineArbitree, vuMatthieu.allDossiers).some(l => l.title === "Appeler le courtier"));

// ════════════════════════════════════════════════════════════════════════════
section("3. Les priorités se relisent depuis la base");

const routinePriorites = routineDepuisLignes([
  { step_key: "priorite", item_type: "priorite", item_id: "0", item_label: "Boucler le financement Bertin",
    responsable: "Matthieu Fumoleau", due_date: AUJ, comment: "Sans quoi le compromis tombe",
    created_at: `${HIER}T08:00:00Z` },
  { step_key: "priorite", item_type: "priorite", item_id: "1", item_label: "Visiter Nantes-014",
    responsable: "Tom Fourmond", due_date: AUJ, comment: "Avant l'offre", created_at: `${HIER}T08:01:00Z` },
]);
verifie("les deux priorités saisies sont relues", 
  routinePriorites.priorities.filter(p => p.title).length === 2);
verifie("la troisième reste vide, sans invention",
  !routinePriorites.priorities[2].title);
verifie("une priorité hors des trois emplacements est ignorée",
  routineDepuisLignes([{ step_key: "priorite", item_id: "7", item_label: "Hors bornes" }])
    .priorities.every(p => !p.title));

// ════════════════════════════════════════════════════════════════════════════
section("4. Le mail dit la vérité sur ce qu'il montre");

const colonnesTest = repartirEnColonnes({ dossiers: vuMatthieu.allDossiers, routine: routineVide, filtre: "all" });
const htmlBase = buildTableauBordHtml({
  prenom: "Matthieu", dateFr: t.dateFr, stats: vuMatthieu.stats,
  colonnes: colonnesTest, priorites: routinePriorites.priorities, dateAffichee: dateFrDe(HIER),
  lignesEcheances: [], plan: [], safeDate,
});

verifie("le client en retard est nommé dans le mail", htmlBase.includes("Léa Bertin"));
verifie("le bien est nommé dans le mail", htmlBase.includes("NANTES-014"));
verifie("les priorités de la veille sont datées, pas présentées comme du jour",
  htmlBase.includes(`Priorités posées le ${dateFrDe(HIER)}`), "titre de section absent");
verifie("la priorité saisie apparaît", htmlBase.includes("Boucler le financement Bertin"));
verifie("le bandeau d'état porte le compte à décider",
  new RegExp(`>${vuMatthieu.stats.decision}</div>`).test(htmlBase));
verifie("les quatre colonnes de l'écran ont leur titre dans le mail",
  ["À décider maintenant", "À surveiller", "Délégué / en attente"].every(x => htmlBase.includes(x)));
verifie("un lien de retour vers l'application est présent",
  htmlBase.includes("Ouvrir le tableau de bord"));

// Taille du mail : au-delà d'environ 102 ko de message transporté, Gmail masque
// la fin derrière un « Message tronqué ». Le lecteur ne voit pas qu'il manque
// quelque chose — il croit avoir tout lu. C'est la panne la plus sournoise que
// ce mail puisse avoir, donc elle est vérifiée sous charge.
const dossiersEnMasse = (n) => {
  const miens = Array.from({ length: n }, (_, i) => ({
    id: `x${i}`, prenom: "Prénom", nom: `Nomdefamille${i}`, etape: "Financement", statut: "actif",
    conseiller: "Matthieu Fumoleau", prochaine_action: "Relancer la banque",
    date_prochaine_action: decale(-19), updated_at: decale(-20),
  }));
  const autres = Array.from({ length: n }, (_, i) => ({
    id: `y${i}`, prenom: "Autre", nom: `Client${i}`, etape: "Compromis", statut: "actif",
    conseiller: "Camille Landais", prochaine_action: "Relancer le notaire",
    date_prochaine_action: decale(3), updated_at: decale(0),
  }));
  // Mes dossiers à échéance future : sans urgence, ils vont « à surveiller ».
  const surveilles = Array.from({ length: n }, (_, i) => ({
    id: `z${i}`, prenom: "Suivi", nom: `Dossier${i}`, statut: "actif", conseiller: "Matthieu Fumoleau", updated_at: decale(0),
  }));
  const dos = [
    ...miens.map(c => dossierDe(c, { etape: "financement", balleUid: "u1", action: "Relancer la banque", echeance: decale(-19), maj: decale(-20) })),
    ...autres.map(c => dossierDe(c, { etape: "acquisition", balleUid: "u2", action: "Relancer le notaire", echeance: decale(3), maj: decale(0) })),
    ...surveilles.map(c => dossierDe(c, { etape: "recherche", balleUid: "u1", action: "Préparer la visite", echeance: decale(4), maj: decale(0) })),
  ];
  const data = consolidateData({ ...DONNEES, clients: [...miens, ...autres, ...surveilles], dossiersInvest: dos.map(x => x.dossier), etapesInvest: dos.map(x => x.etape),
    profil: PROFIL_MATTHIEU, pilote: "Matthieu Fumoleau" });
  return { data, colonnes: repartirEnColonnes({ dossiers: data.allDossiers, routine: routineVide, filtre: "all" }) };
};
const ECHEANCES_EN_MASSE = Array.from({ length: 30 }, (_, i) => ({
  gravite: "urgent", titre: `Urbanisme — DP-2026-${i}`,
  detail: "Dépôt à faire sous 4 jour(s). Rezé · 5 allée des Tilleuls",
  echeance: decale(4), lien: `https://planning-chantiers.vercel.app/?invest_urbanisme=u${i}`,
}));

const sousCharge = (n) => {
  const { data, colonnes } = dossiersEnMasse(n);
  return {
    colonnes,
    html: buildTableauBordHtml({
      prenom: "Matthieu", dateFr: t.dateFr, stats: data.stats, colonnes,
      priorites: routinePriorites.priorities, dateAffichee: dateFrDe(HIER),
      lignesEcheances: ECHEANCES_EN_MASSE, plan: [], safeDate,
    }),
  };
};

for (const n of [25, 400]) {
  const { html } = sousCharge(n);
  verifie(`${n * 2} dossiers + 30 échéances : le mail reste sous ${(TAILLE_MAX_OCTETS / 1024).toFixed(0)} ko`,
    Buffer.byteLength(html) <= TAILLE_MAX_OCTETS,
    `${(Buffer.byteLength(html) / 1024).toFixed(1)} ko`);
}

verifie("les parts de budget couvrent exactement le budget",
  Math.abs(Object.values(PARTS).reduce((a, b) => a + b, 0) - 1) < 1e-9,
  String(Object.values(PARTS).reduce((a, b) => a + b, 0)));

// Aucune section ne doit être affamée par une autre. Le cas réel : trente
// dossiers urgents un lundi, et « Échéances & vigilances » réduite à une ligne
// — alors que c'est là que vivent les dates maximum de dépôt d'urbanisme, qui
// sont des délais opposables.
{
  const { html, colonnes } = sousCharge(400);
  const cartes = (html.match(/Ouvrir la fiche →/g) || []).length;
  const echeancesMontrees = (html.match(/Ouvrir le dossier →/g) || []).length;
  verifie("une colonne à décider surchargée ne vide pas les échéances",
    echeancesMontrees >= 10, `${echeancesMontrees} échéance(s) montrée(s)`);
  // Toute colonne qui a du contenu doit en montrer au moins une ligne : une
  // section affichée « vide » alors qu'elle compte 400 dossiers ne se distingue
  // pas d'une section réellement vide.
  const titres = { watch: "À surveiller", delegated: "Délégué / en attente" };
  for (const [cle, titre] of Object.entries(titres)) {
    if (!colonnes[cle].length) continue;
    const bloc = html.slice(html.indexOf(titre));
    verifie(`la colonne « ${titre} » (${colonnes[cle].length}) n'est pas annoncée vide`,
      !/Aucun dossier dans cette colonne/.test(bloc.slice(0, 600)),
      bloc.slice(0, 200));
  }
  verifie("la colonne « délégué » a bien du contenu dans cette fixture",
    colonnes.delegated.length > 100, String(colonnes.delegated.length));
  verifie("et elle montre tout de même plusieurs dossiers à décider",
    cartes >= 8, `${cartes} carte(s)`);
}

// Le tronquage doit être exact : ce qui est montré plus ce qui est annoncé
// manquant doit faire le compte total. Un tronquage muet, ou mal chiffré, se
// lit comme « il n'y avait que ça ».
{
  const { data, colonnes } = dossiersEnMasse(60);
  const seulementDecider = { decision: colonnes.decision, watch: [], delegated: [], done: [] };
  const html = buildTableauBordHtml({
    prenom: "Matthieu", dateFr: t.dateFr, stats: data.stats, colonnes: seulementDecider,
    priorites: [{}, {}, {}], dateAffichee: null, lignesEcheances: [], plan: [], safeDate,
  });
  const montres = (html.match(/Ouvrir la fiche →/g) || []).length;
  const annonce = Number((html.match(/\+ (\d+) dossier\(s\) non list/) || [])[1] || 0);
  verifie("le titre de colonne porte le compte réel, pas le compte affiché",
    html.includes(`(${colonnes.decision.length})`), `attendu (${colonnes.decision.length})`);
  verifie("montré + annoncé manquant = total",
    montres + annonce === colonnes.decision.length,
    `${montres} montré(s) + ${annonce} annoncé(s) ≠ ${colonnes.decision.length}`);
  verifie("le tronquage n'est jamais muet",
    annonce > 0 && montres > 0, `${montres} / ${annonce}`);
}

// Échappement : un nom de dossier vient de la base, donc d'une saisie humaine.
const htmlInjecte = buildTableauBordHtml({
  prenom: "Matthieu", dateFr: t.dateFr, stats: vuMatthieu.stats,
  colonnes: repartirEnColonnes({
    dossiers: consolidateData({
      ...DONNEES, clients: [{ ...CLIENT_RETARD, nom: '<script>alert(1)</script>' }],
      profil: PROFIL_MATTHIEU, pilote: "Matthieu Fumoleau",
    }).allDossiers, routine: routineVide, filtre: "all" }),
  priorites: [{}, {}, {}], dateAffichee: null, lignesEcheances: [], plan: [], safeDate,
});
verifie("un nom de client n'injecte pas de balise",
  !htmlInjecte.includes("<script>") && htmlInjecte.includes("&lt;script&gt;"));

// Rien à faire : le mail doit le dire, pas se taire ni faire semblant.
const htmlCalme = buildTableauBordHtml({
  prenom: "Matthieu", dateFr: t.dateFr,
  stats: { prospects: 0, clients: 0, biens: 0, decision: 0, watch: 0, delegated: 0, blocked: 0, relancesLate: 0, echeances7: 0 },
  colonnes: { decision: [], watch: [], delegated: [], done: [] },
  priorites: [{}, {}, {}], dateAffichee: null, lignesEcheances: [], plan: [], safeDate,
});
verifie("un tableau de bord vide l'annonce explicitement",
  htmlCalme.includes("rien d'urgent") && htmlCalme.includes("Aucun dossier dans cette colonne"));

// ════════════════════════════════════════════════════════════════════════════
section("5. Les liens ouvrent vraiment la fiche");

// Les clés reconnues à l'arrivée sont celles du bootstrap de PageInvest.jsx.
// Une clé inventée ici produirait un lien qui a l'air de marcher et atterrit
// sur le tableau de bord.
const sourcePageInvest = readFileSync(new URL("../src/Invest/PageInvest.jsx", import.meta.url), "utf8");
const clesReconnues = [...sourcePageInvest.matchAll(/\["(\w+)",\s*\(v\)\s*=>/g)].map(m => m[1]);
verifie("le bootstrap de PageInvest expose bien des clés à lire",
  clesReconnues.length >= 5, clesReconnues.join(", "));

const cas = [
  { item: { type: "client", id: "c1" }, cle: "crm_client" },
  { item: { type: "bien", id: "b1" }, cle: "invest_bien" },
  { item: { type: "prospect", id: "p1", sourceTable: "invest_prospects" }, cle: "invest_prospect" },
  { item: { type: "prospect", id: "p2", sourceTable: "invest_clients" }, cle: "client_id" },
];
for (const c of cas) {
  const lien = lienDossier(c.item);
  verifie(`un ${c.item.type} (${c.item.sourceTable || "—"}) pointe sur ?${c.cle}=`,
    lien.includes(`?${c.cle}=`) && clesReconnues.includes(c.cle), lien);
}
verifie("une action d'équipe rattachée à un client ouvre son action",
  lienDossier({ type: "team", id: "a1", raw: { client_id: "c1" } })
    .includes("?crm_client=c1&mission_action=a1"));
// Une action d'équipe non rattachée n'a aucune fiche à ouvrir. Le repli doit
// être l'application elle-même, pas une URL portant « undefined » — qui a
// l'air d'un lien et n'ouvre rien.
const lienEquipeSeule = lienDossier({ type: "team", id: "a1", raw: {} });
verifie("une action d'équipe sans client renvoie à l'application, sans lien mort",
  lienEquipeSeule === "https://planning-chantiers.vercel.app" &&
  !/undefined|null|\?\w+=$/.test(lienEquipeSeule), lienEquipeSeule);

// ════════════════════════════════════════════════════════════════════════════
section("6. Destinataires");

verifie("la liste réglée à la main a la priorité", (await destinatairesTableauBord(fauxSupabase({
  utilisateurs: UTILISATEURS,
  planning_config: [{ key: "invest_tableau_bord_destinataires", value: { emails: ["camille.landais@groupe-profero.com"] } }],
}))).map(d => d.email).join(",") === "camille.landais@groupe-profero.com");

const parDefaut = await destinatairesTableauBord(fauxSupabase({ utilisateurs: UTILISATEURS, planning_config: [] }));
verifie("à défaut, les rôles qui arbitrent (admin, direction)",
  parDefaut.map(d => d.email).sort().join(",") ===
  "matthieu.fumoleau@groupe-profero.com,tom.fourmond@groupe-profero.com",
  parDefaut.map(d => d.email).join(","));
verifie("un compte désactivé n'est jamais destinataire",
  !parDefaut.some(d => d.email === "ancien@groupe-profero.com"));
verifie("le nom est transporté : sans lui, tout paraîtrait délégué",
  parDefaut.every(d => d.nom));

// ════════════════════════════════════════════════════════════════════════════
section("7. Le cron de bout en bout");

const tablesCron = (extra = {}) => ({
  utilisateurs: UTILISATEURS,
  planning_config: [{ key: "invest_tableau_bord_destinataires", value: { emails: ["matthieu.fumoleau@groupe-profero.com"] } }],
  invest_clients: [CLIENT_RETARD, CLIENT_CAMILLE],
  invest_dossiers: [DOSSIER_RETARD.dossier, DOSSIER_CAMILLE.dossier],
  invest_dossier_etapes: [DOSSIER_RETARD.etape, DOSSIER_CAMILLE.etape],
  invest_biens: [BIEN_SANS_CONSEILLER],
  invest_propositions: [], invest_planning: [], invest_mission_actions: [],
  invest_action_notifications: [], invest_suivi_financier: [], invest_prospects: [],
  invest_morning_routine_items: [
    { routine_date: HIER, step_key: "priorite", item_type: "priorite", item_id: "0",
      item_label: "Boucler le financement Bertin", responsable: "Matthieu Fumoleau",
      due_date: HIER, comment: "Sans quoi le compromis tombe", created_at: `${HIER}T08:00:00Z` },
  ],
  ...extra,
});

const boite7 = [];
const journal7 = {};
const resume7 = await runInvestTableauBord({ headers: {} }, fauxSupabase(tablesCron(), journal7), t, fauxMailer(boite7));

verifie("un mail part au destinataire réglé", boite7.length === 1 && boite7[0].to === "matthieu.fumoleau@groupe-profero.com",
  JSON.stringify(boite7.map(m => m.to)));
verifie("le sujet chiffre ce qu'il y a à décider",
  /^\[Invest\] \d+ dossier\(s\) à décider/.test(boite7[0]?.subject || ""), boite7[0]?.subject);
verifie("le mail porte les dossiers du destinataire",
  (boite7[0]?.html || "").includes("Léa Bertin") && (boite7[0]?.html || "").includes("NANTES-014"));
verifie("il porte aussi la priorité posée la veille, datée",
  (boite7[0]?.html || "").includes("Boucler le financement Bertin") &&
  (boite7[0]?.html || "").includes(`Priorités posées le ${dateFrDe(HIER)}`));
verifie("le résumé rend compte de l'envoi",
  resume7.envoyes.length === 1 && resume7.echecs.length === 0, JSON.stringify(resume7));
verifie("l'état du jour est consigné pour l'idempotence",
  (journal7.upserts || []).some(u => u.valeur?.key === "invest_tableau_bord_state" && u.valeur?.value?.date === AUJ));

// Deuxième déclenchement le même jour : le dispatcher tolère une dérive
// horaire, donc cela arrive.
const boite7b = [];
const resume7b = await runInvestTableauBord({ headers: {} }, fauxSupabase(tablesCron({
  planning_config: [
    { key: "invest_tableau_bord_destinataires", value: { emails: ["matthieu.fumoleau@groupe-profero.com"] } },
    { key: "invest_tableau_bord_state", value: { date: AUJ, emails: ["matthieu.fumoleau@groupe-profero.com"] } },
  ],
})), t, fauxMailer(boite7b));
verifie("second passage le même jour : aucun mail en double",
  boite7b.length === 0 && resume7b.deja_envoye.includes("matthieu.fumoleau@groupe-profero.com"));

// Aucun destinataire : il faut le dire, pas rendre « ok » en silence.
const resume7c = await runInvestTableauBord({ headers: {} }, fauxSupabase({
  utilisateurs: [], planning_config: [],
}), t, fauxMailer([]));
verifie("sans destinataire, le cron l'annonce au lieu de se taire",
  (resume7c.avertissements || []).some(a => /destinataire/i.test(a)), JSON.stringify(resume7c));

// Tables absentes : un environnement sans le module Invest ne doit pas faire
// tomber le cron.
const boite7d = [];
const resume7d = await runInvestTableauBord({ headers: {} }, fauxSupabase({
  utilisateurs: UTILISATEURS,
  planning_config: [{ key: "invest_tableau_bord_destinataires", value: { emails: ["matthieu.fumoleau@groupe-profero.com"] } }],
}), t, fauxMailer(boite7d));
verifie("des tables absentes ne font pas planter le cron",
  Array.isArray(resume7d.echecs) && resume7d.echecs.length === 0, JSON.stringify(resume7d.echecs));
verifie("une table indispensable illisible est signalée, pas avalée",
  (resume7d.avertissements || []).some(a => /indispensable/i.test(a)), JSON.stringify(resume7d.avertissements));

// ════════════════════════════════════════════════════════════════════════════
section("8. Une seule définition de la logique");

const sourceDashboard = readFileSync(new URL("../src/Invest/Dashboard.jsx", import.meta.url), "utf8");

verifie("Dashboard.jsx importe le moteur au lieu d'en garder une copie",
  /from "\.\/tableauBord\.mjs"/.test(sourceDashboard));
verifie("Dashboard.jsx ne redéfinit pas consolidateData",
  !/function consolidateData/.test(sourceDashboard));
verifie("Dashboard.jsx ne redéfinit pas la répartition en colonnes",
  !/d\.category === "decision"/.test(sourceDashboard));
verifie("Dashboard.jsx n'interroge plus les tables Invest directement",
  !/supabase\.from\("invest_(clients|biens|propositions|planning|prospects)"\)\.select/.test(sourceDashboard),
  (sourceDashboard.match(/supabase\.from\("invest_\w+"\)\.select/g) || []).join(", "));
verifie("les libellés de colonnes du mail viennent du module partagé",
  V9_COLONNES.map(c => c.label).every(l => htmlBase.includes(l) || l === "Traité aujourd'hui"),
  V9_COLONNES.map(c => c.label).join(" / "));

// La liste des tables lues est partagée : c'est elle qui garantit que le mail
// voit ce que l'écran voit. On vérifie qu'elle est bien exhaustive.
const cles = REQUETES_TABLEAU_BORD.map(r => r.cle);
verifie("la liste des requêtes couvre tout ce que consolidateData consomme",
  ["clients", "crmProspects", "biens", "propositions", "planning", "actions"].every(k => cles.includes(k)),
  cles.join(", "));
verifie("elle couvre aussi la routine du jour", cles.includes("routineRows"));

const chargees = await chargerTableauBord(fauxSupabase(tablesCron()), { jour: AUJ });
verifie("chargerTableauBord renvoie une clé par requête",
  cles.every(k => Array.isArray(chargees[k])), Object.keys(chargees).join(", "));
verifie("la routine chargée est bien celle du jour demandé",
  (await chargerTableauBord(fauxSupabase(tablesCron()), { jour: HIER })).routineRows.length === 1);

// ════════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(56));
console.log(echecs === 0
  ? `✓ ${passes} vérifications passées.`
  : `✗ ${echecs} échec(s) sur ${passes + echecs} vérifications.`);
process.exit(echecs === 0 ? 0 : 1);
