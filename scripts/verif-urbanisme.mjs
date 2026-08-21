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
console.log("\n" + "═".repeat(56));
console.log(echecs === 0
  ? `✓ ${passes} vérifications passées.`
  : `✗ ${echecs} échec(s) sur ${passes + echecs} vérifications.`);
process.exit(echecs === 0 ? 0 : 1);
