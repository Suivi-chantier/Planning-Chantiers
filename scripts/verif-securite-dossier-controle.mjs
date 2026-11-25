#!/usr/bin/env node
// Vérifie le « Dossier de contrôle » de la fiche sécurité (tâche 9b du projet
// docs/projets/fiche-securite-chantier.md) :
//   - bouton désactivé avec la raison tant qu'il n'y a pas de version validée
//     avec son PDF (ou si son contenu ne correspond plus à l'empreinte) ;
//   - contenu du ZIP : PDF de la dernière version validée, justificatifs du
//     chantier et de l'espace entreprise figés dans cette version ;
//     aptitudes médicales pour un administrateur seulement ;
//   - filtrage confidentiel : pour un non-admin, aucun document confidentiel,
//     ni fichier, ni mention, ni compte ;
//   - A_LIRE.txt quand un fichier est illisible (jamais d'échec silencieux) ;
//   - ZIP « stocké » lisible : en-têtes, CRC-32, répertoire central relus ici.
//
// Exemples issus des tests, données fictives : chantiers, personnes et
// documents sont inventés. Aucune base, aucun réseau.
//   node scripts/verif-securite-dossier-controle.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  derniereVersionPourDossier, planDossierControle, aptitudesRattachees, texteALire, zipStocke, crc32, nomZip, segmentNom,
  estConfidentiel, BUCKET_CONFIDENTIEL, BUCKET_DOCUMENTS, BUCKET_PREUVES, NOM_A_LIRE,
} from "../src/Renovation/securiteDossierControle.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => readFileSync(join(racine, f), "utf8");
const sansCommentaires = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

let n = 0;
async function test(nom, fn) { await fn(); n++; console.log("ok -", nom); }

// ─── Exemples issus des tests, données fictives ──────────────────────────────
const AUJ = "2026-11-25";
const contenu = (extra = {}) => ({
  format: "fiche-securite-v2", version: 2,
  reponses: { p4: { statut: "concerne" }, p6: { statut: "concerne" }, p9: { statut: "non_concerne" } },
  justificatifs: [
    { id: "c2", point: 6, type_code: "recepisse_dict", fichier_nom: "DICT signée.pdf", fichier_path: "securite/chantiers/ch/p6/2.pdf" },
    { id: "c1", point: 4, type_code: "reperage_amiante", fichier_nom: "repérage.pdf", fichier_path: "securite/chantiers/ch/p4/1.pdf" },
    { id: "c3", point: 4, type_code: "aptitude_medicale", fichier_nom: "apt.pdf", fichier_path: "entreprise/aptitude_medicale/x.pdf" }, // ne devrait jamais exister : filtré quand même
  ],
  justificatifs_entreprise: [
    { id: "e1", point: 6, origine: "entreprise", type_code: "habilitation_electrique", personne: "Léa Fictive", fichier_nom: "hab.pdf", fichier_path: "securite/entreprise/habilitation_electrique/1.pdf", expire_le: "2028-01-01" },
    { id: "e2", point: 3, origine: "entreprise", type_code: "duerp", fichier_nom: "duerp.pdf", fichier_path: "securite/entreprise/duerp/1.pdf" },
    { id: "e2", point: 5, origine: "entreprise", type_code: "duerp", fichier_nom: "duerp.pdf", fichier_path: "securite/entreprise/duerp/1.pdf" },
  ],
  ...extra,
});
const version = (extra = {}) => ({ id: "v2", version: 2, pdf_path: "versions/f/v2-fiche.pdf", empreinteVerifiee: true, contenu: contenu(), ...extra });
const APT_OK = { id: "a1", portee: "entreprise", type_code: "aptitude_medicale", personne: "Léa Fictive", confidentiel: true, expire_le: "2027-05-01", fichier_nom: "aptitude.pdf", fichier_path: "entreprise/aptitude_medicale/1.pdf", archive_le: null };
const APT_EXP = { ...APT_OK, id: "a2", expire_le: "2026-10-01" };
const APT_ARCH = { ...APT_OK, id: "a3", archive_le: "2026-11-01T00:00:00Z" };

await test("1. bouton : désactivé avec la raison sans version validée, sans PDF, contenu altéré ; dernière version retenue", () => {
  assert.match(derniereVersionPourDossier([]).raison, /aucune version validée/);
  assert.match(derniereVersionPourDossier(null).raison, /versions illisibles/);
  assert.match(derniereVersionPourDossier([version({ pdf_path: null })]).raison, /PDF de la v2 n'est pas généré/);
  assert.match(derniereVersionPourDossier([version({ empreinteVerifiee: false })]).raison, /ne correspond plus à son empreinte/);
  assert.match(derniereVersionPourDossier([version({ contenu: { format: "autre" } })]).raison, /illisible/);
  const r = derniereVersionPourDossier([version(), version({ id: "v1", version: 1, pdf_path: "versions/f/v1.pdf" })]);
  assert.ok(r.ok && r.version.version === 2, "la plus récente, quel que soit l'ordre");
  // v3 en brouillon n'a pas de ligne de version : la v2 reste la dernière validée.
  assert.ok(derniereVersionPourDossier([version({ contenu: { ...contenu(), format: "fiche-securite-v1" } })]).ok, "une version v1 reste exportable");
});

await test("2. non-admin : PDF + chantier + espace entreprise, AUCUN document confidentiel (ni fichier, ni mention)", () => {
  const { fichiers } = planDossierControle({ version: version(), chantierNom: "RÉSIDENCE FICTIVE APPT 3", estAdmin: false, aptitudes: [APT_OK], aujourdhui: AUJ });
  assert.deepEqual(fichiers.map((f) => f.nom), [
    "00_Fiche-securite-RESIDENCE-FICTIVE-APPT-3-v2.pdf",
    "Chantier/P04_Reperage-amiante-avant-travaux_reperage.pdf",
    "Chantier/P06_Recepisse-de-DICT_DICT-signee.pdf",
    "Espace-entreprise/P03_Document-unique-DUERP_duerp.pdf",
    "Espace-entreprise/P06_Habilitation-electrique_Lea-Fictive_hab.pdf",
  ]);
  assert.deepEqual(fichiers.map((f) => f.bucket), [BUCKET_PREUVES, BUCKET_DOCUMENTS, BUCKET_DOCUMENTS, BUCKET_DOCUMENTS, BUCKET_DOCUMENTS]);
  assert.ok(!fichiers.some((f) => f.bucket === BUCKET_CONFIDENTIEL || /aptitude|Confidentiel/i.test(f.nom + f.libelle)), "rien de confidentiel");
  assert.equal(fichiers.filter((f) => /duerp/.test(f.nom)).length, 1, "un document rattaché à deux points : un seul fichier");
  assert.deepEqual(aptitudesRattachees({ contenu: contenu(), aptitudes: [APT_OK], aujourdhui: AUJ, estAdmin: false }), []);
});

await test("3. admin : aptitudes médicales valides rattachées au point 4 concerné, dans « Confidentiel/ »", () => {
  const { fichiers } = planDossierControle({ version: version(), chantierNom: "X", estAdmin: true, aptitudes: [APT_EXP, APT_OK, APT_ARCH, { ...APT_OK, id: "a4", portee: "chantier" }], aujourdhui: AUJ });
  const conf = fichiers.filter((f) => f.bucket === BUCKET_CONFIDENTIEL);
  assert.deepEqual(conf.map((f) => f.nom), ["Chantier/P04_Aptitude-medicale-confidentiel_apt.pdf", "Confidentiel/P04_Aptitude-medicale-confidentiel_Lea-Fictive_aptitude.pdf"],
    "valide seulement (expirée, archivée, mauvaise portée écartées)");
  const sansP4 = contenu({ reponses: { p4: { statut: "non_concerne" } } });
  assert.deepEqual(aptitudesRattachees({ contenu: sansP4, aptitudes: [APT_OK], aujourdhui: AUJ, estAdmin: true }), [], "point 4 non concerné : aucune aptitude");
  assert.ok(estConfidentiel({ type_code: "aptitude_medicale" }) && estConfidentiel({ type_code: "duerp", confidentiel: true }) && !estConfidentiel({ type_code: "duerp" }));
});

await test("4. noms de fichiers : sans accents ni « / », doublons numérotés, nom du ZIP", () => {
  assert.equal(segmentNom("Plan / étage ../../secret"), "Plan-etage-secret");
  const v = version({ contenu: contenu({ justificatifs: [
    { id: "a", point: 4, type_code: "reperage_amiante", fichier_nom: "doc.pdf", fichier_path: "p/a" },
    { id: "b", point: 4, type_code: "reperage_amiante", fichier_nom: "doc.pdf", fichier_path: "p/b" },
    { id: "c", point: 4, type_code: "reperage_amiante", fichier_nom: null, fichier_path: "p/1700000000_scan.jpg" },
    { id: "d", point: 4, type_code: "reperage_amiante", fichier_nom: "sans-chemin.pdf", fichier_path: "" },
  ], justificatifs_entreprise: [] }) });
  const noms = planDossierControle({ version: v, chantierNom: "", estAdmin: false, aujourdhui: AUJ }).fichiers.map((f) => f.nom);
  assert.deepEqual(noms, ["00_Fiche-securite-chantier-v2.pdf", "Chantier/P04_Reperage-amiante-avant-travaux_doc.pdf", "Chantier/P04_Reperage-amiante-avant-travaux_doc-2.pdf", "Chantier/P04_Reperage-amiante-avant-travaux_1700000000_scan.jpg"]);
  assert.equal(nomZip({ chantierNom: "MONTILLERS APPT 1 (T3)", version: 2, date: AUJ }), "Dossier-controle-MONTILLERS-APPT-1-T3-v2-2026-11-25.zip");
});

await test("5. A_LIRE.txt : liste ce qui manque, avec la raison", () => {
  const t = texteALire({ manquants: [{ nom: "Chantier/P04_x.pdf", libelle: "Repérage amiante avant travaux (point 4)", raison: "Lecture refusée : Object not found" }], chantierNom: "CHANTIER FICTIF", version: 2, date: "2026-11-25 10:00:00" });
  assert.match(t, /1 document n'a pas pu être lu/);
  assert.match(t, /- Repérage amiante avant travaux \(point 4\) \(fichier prévu : Chantier\/P04_x\.pdf\) : Lecture refusée : Object not found/);
  assert.match(texteALire({ manquants: [{}, {}], version: 1 }), /2 documents n'ont pas pu être lus/);
  assert.equal(NOM_A_LIRE, "A_LIRE.txt");
});

// Relecture indépendante d'un ZIP stocké (en-têtes locaux, répertoire central, CRC).
function relireZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder();
  let fin = buf.length - 22;
  assert.equal(dv.getUint32(fin, true), 0x06054b50, "fin du répertoire central");
  const nb = dv.getUint16(fin + 10, true), taille = dv.getUint32(fin + 12, true), debut = dv.getUint32(fin + 16, true);
  assert.equal(debut + taille, fin);
  const out = [];
  let p = debut;
  for (let i = 0; i < nb; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    assert.equal(dv.getUint16(p + 8, true) & 0x0800, 0x0800, "noms en UTF-8");
    assert.equal(dv.getUint16(p + 10, true), 0, "méthode : stocké");
    const crc = dv.getUint32(p + 16, true), lg = dv.getUint32(p + 20, true), ln = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const nom = dec.decode(buf.subarray(p + 46, p + 46 + ln));
    assert.equal(dv.getUint32(off, true), 0x04034b50, "en-tête local");
    assert.equal(dv.getUint32(off + 14, true), crc);
    const lnl = dv.getUint16(off + 26, true);
    const data = buf.subarray(off + 30 + lnl, off + 30 + lnl + lg);
    assert.equal(crc32(data), crc, `CRC ${nom}`);
    out.push({ nom, texte: dec.decode(data) });
    p += 46 + ln;
  }
  return out;
}

await test("6. ZIP stocké : CRC-32 de référence, relu fichier par fichier, noms UTF-8, sans horloge", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926, "CRC-32 de référence");
  const enc = new TextEncoder();
  const zip = zipStocke([
    { nom: NOM_A_LIRE, octets: enc.encode("à lire") },
    { nom: "Espace-entreprise/P06_Habilitation.pdf", octets: enc.encode("%PDF-1.4 fictif") },
    { nom: "vide.txt", octets: new Uint8Array(0) },
  ], "2026-11-25T10:31:08");
  assert.deepEqual(relireZip(zip), [
    { nom: "A_LIRE.txt", texte: "à lire" },
    { nom: "Espace-entreprise/P06_Habilitation.pdf", texte: "%PDF-1.4 fictif" },
    { nom: "vide.txt", texte: "" },
  ]);
  const z2 = zipStocke([{ nom: "a.txt", octets: enc.encode("x") }], "2026-11-25T10:31:08");
  assert.deepEqual([...z2], [...zipStocke([{ nom: "a.txt", octets: enc.encode("x") }], "2026-11-25T10:31:08")], "même entrée, même ZIP");
  assert.deepEqual(relireZip(zipStocke([], AUJ)), [], "ZIP vide lisible");
});

await test("7. branchements : bouton sur la fiche, raison affichée, A_LIRE dans la couche données, module pur", () => {
  const ecran = lire("src/Renovation/FicheSecuriteChantier.jsx");
  assert.match(ecran, /disabled=\{!etatDossier\.ok \|\| dossier\.enCours\}/);
  assert.match(ecran, /Indisponible : \$\{etatDossier\.raison\}/);
  assert.match(ecran, /Dossier téléchargé INCOMPLET/);
  assert.match(ecran, /preparerDossierControle\(\{ ficheId, chantierNom: chantier\.nom, estAdmin: profil\?\.role === "admin" \}\)/);
  const donnees = sansCommentaires(lire("src/Renovation/securiteDonnees.js"));
  const fn = donnees.slice(donnees.indexOf("export async function preparerDossierControle"));
  assert.match(fn, /if \(estAdmin === true\) \{/, "aptitudes lues pour un admin seulement");
  assert.match(fn, /contenus\.unshift\(\{ nom: NOM_A_LIRE/);
  assert.match(fn, /planDossierControle\(\{ version: d\.version, chantierNom, estAdmin: estAdmin === true, aptitudes, aujourdhui \}\)/);
  const mod = sansCommentaires(lire("src/Renovation/securiteDossierControle.mjs"));
  assert.ok(!/supabase|new Date\(\)|Date\.now\(\)|import\s.*from\s+"(?!\.)/.test(mod), "module pur, sans bibliothèque");
  assert.match(lire("src/Renovation/securiteDossierControle.js"), /export \* from "\.\/securiteDossierControle\.mjs"/);
  const pkg = JSON.parse(lire("package.json"));
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => /zip|fflate/i.test(d)), "aucune dépendance ZIP ajoutée");
  const st = sansCommentaires(lire("src/Renovation/storageChantier.js"));
  assert.match(st, /const BUCKETS_DOSSIER = \[BUCKET_CHANTIER_DOCS, BUCKET_PREUVES_SECURITE, BUCKET_CONFIDENTIEL_SECURITE\];/);
});

await test("8. journal des MAJ : entrée « Dossier de contrôle »", () => {
  assert.match(lire("src/Renovation/journalMaj.js"), /Dossier de contrôle/);
});

console.log(`\n${n} vérifications « Fiche sécurité : dossier de contrôle » réussies (exemples issus des tests, données fictives).`);
