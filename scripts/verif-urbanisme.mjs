// scripts/verif-urbanisme.mjs — Aller-retour des données d'une FDU.
//
// Pourquoi ce script : `urbaExigences` reconstruit chaque pièce CHAMP PAR CHAMP
// depuis d.pieces[id]. Tout champ oublié dans cette reconstruction disparaît
// silencieusement de ce que voit l'interface — alors qu'il est bien enregistré
// en base.
//
// Symptôme vécu le 2026-08-21 : « quand je joins un fichier, rien ne reste ».
// Le fichier partait bien dans le bucket, `donnees.pieces[id].fichiers` était
// bien persisté, mais urbaExigences ne restituait pas ce champ. L'écran lisait
// un champ absent, donc affichait une liste vide, et l'utilisateur en concluait
// que le téléversement avait échoué.
//
// Aucune erreur, aucun avertissement, aucun échec de build : seul un test
// d'aller-retour peut attraper ça. Il vérifie que TOUT ce que l'interface écrit
// dans une pièce revient par urbaExigences, et survit à urbaColonnes — la
// fonction qui construit la ligne enregistrée.
//
// Le store importe ../supabase, qui n'existe pas hors navigateur (import.meta.env).
// esbuild le bundle avec un substitut : toute la logique pure devient testable
// sans base ni réseau.
//
// Usage :  node scripts/verif-urbanisme.mjs

import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

let passes = 0, echecs = 0;
function verifie(nom, ok, detail = "") {
  if (ok) { passes++; console.log(`  ✓ ${nom}`); }
  else { echecs++; console.log(`  ✗ ${nom}${detail ? `\n      ${detail}` : ""}`); }
}
function section(t) { console.log(`\n${t}\n${"─".repeat(t.length)}`); }

// ── Bundle du store, supabase remplacé par un substitut inerte ─────────────
const dossier = mkdtempSync(join(tmpdir(), "verif-urba-"));
const stub = join(dossier, "supabase-stub.js");
writeFileSync(stub, "export const supabase = { from: () => ({}), storage: { from: () => ({}) } };\n");

const sortie = join(dossier, "store.mjs");
// `alias` n'accepte que des noms de paquets, pas des chemins relatifs : on
// intercepte la résolution.
await esbuild.build({
  entryPoints: ["src/Invest/urbanismeStore.js"],
  outfile: sortie,
  bundle: true, format: "esm", platform: "neutral", logLevel: "silent",
  plugins: [{
    name: "stub-supabase",
    setup(build) {
      build.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: stub }));
    },
  }],
});
const S = await import(sortie);

// ════════════════════════════════════════════════════════════════════════════
section("1. Aller-retour d'une pièce");

// Tous les champs que l'interface écrit dans une pièce (LignePiece).
const PIECE_SAISIE = {
  statut: "recue",
  responsable: "Camille",
  lien: "https://drive.google.com/dossier",
  commentaire: "version 2 signée le 12/08",
  fichiers: [
    { path: "urbanisme/d1/CERFA_1_plan.jpg", nom: "plan.jpg", type: "image/jpeg", taille: 240000 },
    { path: "urbanisme/d1/CERFA_2_notice.pdf", nom: "notice.pdf", type: "application/pdf", taille: 88000 },
  ],
};

const base = S.urbaDossierVide({});
const premiereId = S.URBA_PIECES[0].id;
const d = { ...base, pieces: { [premiereId]: { ...PIECE_SAISIE } } };

const relue = S.urbaExigences(d).find(p => p.id === premiereId);
verifie("la pièce est retrouvée par urbaExigences", !!relue);

for (const champ of Object.keys(PIECE_SAISIE)) {
  if (champ === "fichiers") continue;
  verifie(`« ${champ} » revient intact`,
    relue?.[champ] === PIECE_SAISIE[champ],
    `attendu ${JSON.stringify(PIECE_SAISIE[champ])}, obtenu ${JSON.stringify(relue?.[champ])}`);
}

verifie("« fichiers » revient avec ses 2 entrées",
  Array.isArray(relue?.fichiers) && relue.fichiers.length === 2,
  `obtenu ${JSON.stringify(relue?.fichiers)}`);
verifie("les chemins Storage sont préservés",
  relue?.fichiers?.[0]?.path === PIECE_SAISIE.fichiers[0].path);

// Le garde-fou qui compte : aucun champ saisi ne doit être perdu en route.
const perdus = Object.keys(PIECE_SAISIE).filter(c => {
  const v = relue?.[c];
  return v === undefined || (Array.isArray(PIECE_SAISIE[c]) && !Array.isArray(v));
});
verifie("AUCUN champ saisi n'est supprimé par urbaExigences", perdus.length === 0,
  perdus.length ? `champs perdus : ${perdus.join(", ")}` : "");

// ════════════════════════════════════════════════════════════════════════════
section("2. Survie à l'enregistrement");

const colonnes = S.urbaColonnes(d, "brouillon");
verifie("urbaColonnes reconduit donnees",
  !!colonnes?.donnees?.pieces?.[premiereId]);
verifie("les pièces jointes survivent à l'enregistrement",
  colonnes?.donnees?.pieces?.[premiereId]?.fichiers?.length === 2,
  `obtenu ${JSON.stringify(colonnes?.donnees?.pieces?.[premiereId]?.fichiers)}`);
verifie("le nombre de pièces manquantes est recalculé",
  typeof colonnes?.nb_pieces_manquantes === "number");

// ════════════════════════════════════════════════════════════════════════════
section("3. Défauts d'une pièce jamais touchée");

const vide = S.urbaExigences(base).find(p => p.id === premiereId);
verifie("fichiers vaut un tableau vide, pas undefined",
  Array.isArray(vide?.fichiers) && vide.fichiers.length === 0,
  "un undefined ferait planter .map dans LignePiece");
verifie("statut par défaut renseigné", !!vide?.statut);

// ════════════════════════════════════════════════════════════════════════════
section("4. Validation des fichiers");

verifie("un JPG de 2 Mo est accepté",
  S.urbaFichierAcceptable({ type:"image/jpeg", size:2e6, name:"a.jpg" }) === null);
verifie("un PDF est accepté",
  S.urbaFichierAcceptable({ type:"application/pdf", size:1e6, name:"a.pdf" }) === null);
verifie("un fichier Word est refusé",
  typeof S.urbaFichierAcceptable({ type:"application/msword", size:1e5, name:"a.doc" }) === "string");
verifie("un fichier de 20 Mo est refusé",
  typeof S.urbaFichierAcceptable({ type:"image/jpeg", size:20e6, name:"a.jpg" }) === "string");
verifie("un fichier absent est refusé", typeof S.urbaFichierAcceptable(null) === "string");

verifie("urbaEstImage reconnaît un JPEG par son type",
  S.urbaEstImage({ type:"image/jpeg", nom:"x" }) === true);
verifie("urbaEstImage reconnaît un PNG par son nom",
  S.urbaEstImage({ type:"", nom:"plan.PNG" }) === true);
verifie("urbaEstImage ne prend pas un PDF pour une image",
  S.urbaEstImage({ type:"application/pdf", nom:"notice.pdf" }) === false);

// ════════════════════════════════════════════════════════════════════════════
section("5. Les annexes sont bien DANS le document imprimé");

// Ce bloc existe à cause d'une erreur de séquencement : le calcul des annexes
// avait été placé APRÈS l'assemblage du HTML. `corps.join()` figeant le
// document, le corps.push() postérieur n'avait aucun effet — les annexes
// n'apparaissaient jamais, sans la moindre erreur.
//
// Un test sur les données ne pouvait pas l'attraper : il faut inspecter le HTML
// réellement produit.

const sortieImpr = join(dossier, "impression.mjs");
await esbuild.build({
  entryPoints: ["src/Invest/urbanismeImpression.js"],
  outfile: sortieImpr,
  bundle: true, format: "esm", platform: "neutral", logLevel: "silent",
  plugins: [{
    name: "stub-supabase",
    setup(build) { build.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: stub })); },
  }],
});
const I = await import(sortieImpr);

// Fenêtre factice : on capture le HTML au lieu de l'imprimer.
let htmlProduit = "";
globalThis.window = {
  // Une origine est nécessaire : sans elle le logo n'est pas émis, et le test
  // ne vérifierait jamais la furniture de page.
  location: { origin: "https://planning-chantiers.vercel.app" },
  open: () => ({
    document: {
      write: (h) => { htmlProduit += h; },
      close: () => {},
      images: [],
      fonts: { ready: Promise.resolve() },
    },
    focus: () => {}, print: () => {},
  }),
};
globalThis.alert = () => {};

const rowTest = { reference: "FDU-TEST", statut: "brouillon", donnees: d };
const pagesAnnexes = [
  { piece: "Plan de masse", nom: "masse.jpg", url: "https://signe/masse.jpg", page: 1, total: 1 },
  { piece: "Notice",        nom: "notice.pdf", url: "data:image/jpeg;base64,AAAA", page: 1, total: 3 },
  { piece: "Notice",        nom: "notice.pdf", url: "data:image/jpeg;base64,BBBB", page: 2, total: 3 },
];
const annexesIgnorees = [{ piece: "Plan de coupe", nom: "coupe.dwg", raison: "format non rendu" }];

I.imprimerFDU(rowTest, { pagesAnnexes, annexesIgnorees });

verifie("le document contient la section Annexes",
  /Annexes — pièces jointes/.test(htmlProduit),
  "c'est exactement ce qui manquait : le push arrivait après corps.join()");
verifie("chaque page d'annexe produit une section",
  (htmlProduit.match(/class="annexe-page"/g) || []).length === 3,
  `${(htmlProduit.match(/class="annexe-page"/g) || []).length} section(s) pour 3 pages fournies`);
verifie("l'image signée est référencée",
  htmlProduit.includes("https://signe/masse.jpg"));
verifie("les pages de PDF rendues sont incorporées",
  htmlProduit.includes("data:image/jpeg;base64,AAAA")
  && htmlProduit.includes("data:image/jpeg;base64,BBBB"),
  "un PDF doit faire partie du dossier, pas seulement y être listé");
verifie("la pagination d'un PDF multipage est indiquée",
  /page 2\/3/.test(htmlProduit));
verifie("ce qui n'a pas pu être rendu est signalé",
  /non reproduites/.test(htmlProduit) && htmlProduit.includes("coupe.dwg"),
  "une pièce absente du dossier doit se voir");
verifie("le saut de page avant chaque annexe est présent",
  /page-break-before/.test(htmlProduit));

// Sans annexes, le document doit rester propre.
htmlProduit = "";
I.imprimerFDU(rowTest);
// Attention à ce qu'on teste : la règle CSS « .annexe-page » figure toujours
// dans la feuille de style. Ce qui doit être absent, c'est une SECTION.
verifie("sans annexe, aucune section d'annexe",
  !/class="annexe-page"/.test(htmlProduit) && !/Annexes — pièces jointes/.test(htmlProduit),
  `sections trouvées : ${(htmlProduit.match(/class="annexe-page"/g) || []).length}`);
verifie("le corps de la FDU est là dans tous les cas",
  /Fiche de demande urbanisme/.test(htmlProduit));

// ════════════════════════════════════════════════════════════════════════════
section("6. Furniture de page — identique sur chaque page");

verifie("l'en-tête est en position fixe, donc répété à chaque page",
  /\.entete\{position:fixed/.test(htmlProduit),
  "sans position:fixed, l'en-tête n'apparaît que sur la première page");
verifie("le pied est en position fixe",
  /\.pied\{position:fixed/.test(htmlProduit));
verifie("les marges de @page réservent la place de la furniture",
  /@page\{size:A4;margin:27mm 15mm 19mm\}/.test(htmlProduit),
  "sans marges suffisantes, en-tête et pied recouvrent le contenu dès la page 2");
verifie("le logo Groupe Profero est en absolu",
  htmlProduit.includes("https://planning-chantiers.vercel.app/logos/groupe-profero-h.png"),
  "une URL relative ne résout pas dans une fenêtre about:blank");
verifie("la référence du dossier figure dans le pied",
  /class="pied"[\s\S]*?FDU-TEST/.test(htmlProduit),
  "c'est ce qui identifie un feuillet détaché du dossier");

// Un plus unaire sur une chaîne donne NaN : c'est arrivé sur l'en-tête, où le
// titre a été remplacé par « NaN » sans que rien ne le signale.
verifie("aucun NaN dans le document", !htmlProduit.includes("NaN"),
  "un « + + » dans la concaténation produit un plus unaire, donc NaN");

verifie("un seul pied de page dans le document",
  (htmlProduit.match(/<footer/g) || []).length === 1,
  "le pied fixe et un pied de fin de document feraient doublon sur la dernière page");

verifie("l'or Groupe Profero est déclaré une seule fois comme variable",
  /--or:#c9a14f/.test(htmlProduit));

// ════════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(56));
console.log(echecs === 0
  ? `✓ ${passes} vérifications passées.`
  : `✗ ${echecs} échec(s) sur ${passes + echecs} vérifications.`);
process.exit(echecs === 0 ? 0 : 1);
