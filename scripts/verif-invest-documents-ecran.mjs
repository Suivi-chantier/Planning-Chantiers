#!/usr/bin/env node
// Vérifie l'onglet Documents d'une mission : logique pure (piecesMission.mjs) et règles du composant.
// Exemples issus des tests, données fictives : aucune donnée réelle.
//   node scripts/verif-invest-documents-ecran.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as D from "../src/Invest/dossiers/piecesMission.mjs";
import { ONGLETS_FICHE } from "../src/Invest/dossiers/ficheDossierVue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (r) => readFileSync(join(racine, r), "utf8");
const COMP = lire("src/Invest/dossiers/DocumentsMission.jsx");
const FICHE = lire("src/Invest/dossiers/FicheDossier.jsx");
let n = 0, total = 0;
const test = (nom, fn) => { total++; try { fn(); n++; console.log(`  ✔ ${nom}`); } catch (e) { console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); process.exitCode = 1; } };
const P = (x) => ({ genre: "piece_client", categorie: "identite", libelle: "L", obligatoire: false, statut: "a_demander", ...x });

test("1. avancement : « sans objet » sort du total, vide = pas de pourcentage, obligatoires manquantes comptées", () => {
  assert.deepEqual(D.avancementPieces([]), { total: 0, recues: 0, manquantesObligatoires: 0, pourcentage: null });
  const a = D.avancementPieces([P({ statut: "recue" }), P({ statut: "validee" }), P({ statut: "a_demander", obligatoire: true }), P({ statut: "demandee", obligatoire: true }), P({ statut: "demandee" }), P({ statut: "sans_objet", obligatoire: true }), { ...P({}), genre: "document_profero", statut: "a_produire" }]);
  assert.deepEqual(a, { total: 5, recues: 2, manquantesObligatoires: 2, pourcentage: 40 });
  assert.equal(D.avancementPieces([P({ statut: "sans_objet" })]).pourcentage, null, "tout sans objet : pas de 100 %");
});
test("2. pièces groupées par catégorie dans l'ordre voulu, obligatoires d'abord ; catégorie inconnue en dernier, sous sa clé", () => {
  const g = D.piecesParCategorie([P({ categorie: "bancaire", libelle: "RIB" }), P({ categorie: "inconnue_x", libelle: "Z" }), P({ categorie: "identite", libelle: "Domicile" }), P({ categorie: "identite", libelle: "CNI", obligatoire: true }), { ...P({}), genre: "document_profero" }]);
  assert.deepEqual(g.map((x) => x.cle), ["identite", "bancaire", "inconnue_x"]);
  assert.deepEqual(g[0].pieces.map((x) => x.libelle), ["CNI", "Domicile"]);
  assert.equal(g[2].libelle, "inconnue_x");
  assert.equal(g.flatMap((x) => x.pieces).length, 4, "aucun document Profero dans les pièces du client");
});
test("3. documents Profero : lettre de mission, puis rapport de restitution, puis le reste", () => {
  const d = D.documentsProfero([{ ...P({ categorie: "analyse", libelle: "Analyse" }), genre: "document_profero" }, { ...P({ categorie: "rapport_restitution", libelle: "Rapport" }), genre: "document_profero" },
    { ...P({ categorie: "lettre_mission", libelle: "Lettre" }), genre: "document_profero" }, P({ libelle: "Pièce" })]);
  assert.deepEqual(d.map((x) => x.libelle), ["Lettre", "Rapport", "Analyse"]);
});
test("4. changer le statut : la date est posée UNE fois, jamais écrasée ni effacée", () => {
  assert.deepEqual(D.patchStatutPiece(P({}), "demandee", "2026-10-02"), { statut: "demandee", demande_le: "2026-10-02" });
  assert.deepEqual(D.patchStatutPiece(P({ demande_le: "2026-09-01" }), "demandee", "2026-10-02"), { statut: "demandee" });
  assert.deepEqual(D.patchStatutPiece(P({}), "recue", "2026-10-02"), { statut: "recue", recu_le: "2026-10-02" });
  assert.deepEqual(D.patchStatutPiece(P({}), "validee", "2026-10-02", "Tom"), { statut: "validee", recu_le: "2026-10-02", valide_le: "2026-10-02", valide_par: "Tom" });
  assert.deepEqual(D.patchStatutPiece(P({ recu_le: "2026-09-05", valide_le: "2026-09-06", valide_par: "Cam" }), "validee", "2026-10-02", "Tom"), { statut: "validee" });
  assert.deepEqual(D.patchStatutPiece(P({ recu_le: "2026-09-05" }), "a_demander", "2026-10-02"), { statut: "a_demander" }, "revenir en arrière n'efface rien");
});
test("5. dépôt et retrait d'un fichier : un statut avancé ne recule jamais au dépôt", () => {
  assert.equal(D.statutApresDepot(P({ statut: "a_demander" })), "recue"); assert.equal(D.statutApresDepot(P({ statut: "demandee" })), "recue");
  assert.equal(D.statutApresDepot(P({ statut: "validee" })), "validee"); assert.equal(D.statutApresDepot(P({ statut: "sans_objet" })), "recue");
  const doc = (statut) => ({ genre: "document_profero", statut });
  assert.equal(D.statutApresDepot(doc("a_produire")), "depose"); assert.equal(D.statutApresDepot(doc("remis_client")), "remis_client");
  assert.equal(D.statutApresRetraitFichier(P({ statut: "recue" })), "demandee"); assert.equal(D.statutApresRetraitFichier(P({ statut: "sans_objet" })), "sans_objet");
  assert.equal(D.statutApresRetraitFichier(doc("depose")), "a_produire"); assert.equal(D.statutApresRetraitFichier(doc("a_produire")), "a_produire");
});
test("6. chemin de stockage : toujours dans le dossier de la mission (même règle que la base), nom sûr", () => {
  const c = "11111111-1111-1111-1111-1111111111a1", d = "22222222-2222-2222-2222-2222222222a1";
  const chemin = D.cheminFichier(c, d, "piece_client", "Relevé n°1 (final).PDF", 1700000000000);
  assert.equal(chemin, `clients/${c}/mission/${d}/piece_client/1700000000000_Releve_n_1_final.pdf`);
  assert.ok(chemin.startsWith(`clients/${c}/mission/${d}/`) && !chemin.includes(".."), "conforme à la contrainte de la base");
  assert.equal(D.nomSur("../../etc/passwd"), "passwd"); assert.equal(D.nomSur("C:\\dossier\\Mon fichier.pdf"), "Mon_fichier.pdf"); assert.equal(D.nomSur("..."), "fichier"); assert.equal(D.nomSur("a b.TXT"), "a_b.txt");
  assert.ok(!D.cheminFichier(c, d, "piece_client", "../../autre/x.pdf", 1).includes(".."));
});
test("7. rapport de restitution : la date n'est jamais déduite ; on la propose seulement si le rapport est déposé et la date absente", () => {
  const rapport = (chemin) => ({ genre: "document_profero", categorie: "rapport_restitution", chemin });
  assert.deepEqual(D.etatRestitution({ restitution_le: null }, []), { present: false, depose: false, dateEnregistree: null, proposerDate: false });
  assert.equal(D.etatRestitution({ restitution_le: null }, [rapport(null)]).proposerDate, false, "rapport pas encore déposé");
  assert.equal(D.etatRestitution({ restitution_le: null }, [rapport("clients/x")]).proposerDate, true);
  const faite = D.etatRestitution({ restitution_le: "2026-09-15T00:00:00Z" }, [rapport("clients/x")]);
  assert.equal(faite.proposerDate, false); assert.equal(faite.dateEnregistree, "2026-09-15");
});
test("8. libellés : un statut inconnu s'affiche tel quel, jamais comme « reçue »", () => {
  assert.equal(D.libelleStatut("piece_client", "recue"), "Reçue"); assert.equal(D.libelleStatut("document_profero", "remis_client"), "Remis au client");
  assert.equal(D.libelleStatut("piece_client", "bizarre"), "bizarre"); assert.equal(D.libelleStatut("piece_client", null), "—");
  assert.ok(!("depose" in D.STATUTS_PIECE) && !("recue" in D.STATUTS_DOCUMENT));
});
test("9. composant : n'écrit que les pièces et les partages, dans le bucket des documents, sans portail ni client", () => {
  const ecritures = [...COMP.matchAll(/supabase\s*\.from\("([a-z_]+)"\)\s*\.(insert|update|delete|upsert)/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.ok(ecritures.length >= 6);
  for (const e of ecritures) assert.match(e, /^(invest_dossier_pieces|invest_documents_partages)\./, e);
  assert.match(COMP, /const BUCKET = "invest-documents"/); assert.ok(!/from\("invest_clients"\)|portail_/.test(COMP));
  assert.match(COMP, /cheminFichier\(client\.id, dossier\.id, p\.genre, f\.name, Date\.now\(\)\)/);
  assert.match(COMP, /supabase\.rpc\("invest_dossier_pieces_preparer", \{ p_dossier_id: dossier\.id \}\)/);
});
test("10. composant : confirmation avant partager, retirer un fichier et supprimer ; pas de fichier orphelin ; mission close en lecture seule", () => {
  for (const m of [/Partager « \$\{p\.libelle\} » avec le client/, /Retirer le fichier de « \$\{p\.libelle\} »/, /Supprimer « \$\{p\.libelle\} » de la liste/]) assert.match(COMP, m);
  assert.match(COMP, /catch \(e\) \{ await supabase\.storage\.from\(BUCKET\)\.remove\(\[chemin\]\); throw e; \}/);
  assert.ok((COMP.match(/modifiable &&/g) || []).length >= 8, "les gestes sont réservés à une mission modifiable");
  assert.match(COMP, /disabled=\{!modifiable \|\| occupe\}/);
  assert.match(COMP, /Mission close : consultation seule/);
});
test("11. composant : la date de restitution est proposée, jamais enregistrée par l'onglet", () => {
  assert.match(COMP, /rest\.proposerDate && modifiable && onRestitution && <button[^>]*onClick=\{onRestitution\}>Enregistrer la date de restitution/);
  assert.ok(!/restitution_le/.test(COMP.replace(/\/\/.*$/gm, "")), "l'onglet n'écrit pas restitution_le");
});
test("12. composants stables : Carte hors du composant principal (le curseur ne saute pas à la frappe)", () => {
  assert.ok(COMP.indexOf("function Carte({ T,") > 0 && COMP.indexOf("function Carte({ T,") < COMP.indexOf("export default function DocumentsMission"));
  assert.ok(!/const (Carte|Fichier|SelectStatut) = \(/.test(COMP));
});
test("13. fiche Mission : l'onglet Documents affiche le composant, n'est plus « en préparation », les autres modules le restent", () => {
  assert.match(FICHE, /\{onglet === "documents" && <DocumentsMission T=\{T\} client=\{client\} dossier=\{fiche\.dossier\} profil=\{profil\} modifiable=\{fiche\.modifiable\} onRestitution=\{\(\) => setGeste\("restitution"\)\} \/>\}/);
  assert.equal(ONGLETS_FICHE.find((o) => o.cle === "documents").enPreparation, undefined);
  assert.deepEqual(ONGLETS_FICHE.filter((o) => o.enPreparation).map((o) => o.cle), ["analyse", "strategie", "financement", "acquisition"]);
});

console.log(`\n${n}/${total} contrôles conformes`);
