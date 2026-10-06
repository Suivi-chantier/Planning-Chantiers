#!/usr/bin/env node
// Vérifie le dépôt de pièces par le client (migration 20261002200000 + fonction portail-depot-document).
// Base : VRAI PostgreSQL en mémoire (PGlite). Règles du dépôt : module pur regles.mjs. Fonction : ordre des contrôles.
// Données : exemple issu des tests, données fictives (aucune donnée réelle).
//   node scripts/verif-portail-depots.mjs
import assert from "node:assert/strict";
import { ID, J, jeton, lire, nouvelleBase, sous, lanceur } from "./lib/banc-invest.mjs";
import * as R from "../supabase/functions/portail-depot-document/regles.mjs";

const { test, lancer } = lanceur();
const LIAISON = "supabase/migrations/20261001190000_portail_client_invest_liaison.sql";
const DEPOTS = "supabase/migrations/20261002200000_portail_client_invest_depots.sql";
const ROLLBACK = lire("sql/202610_portail_client_invest_depots_rollback.sql");
const FN = lire("supabase/functions/portail-depot-document/index.ts").replace(/^\s*\/\/.*$/gm, "");   // le code, sans les commentaires
const CLIENT_B = "00000000-0000-0000-0000-0000000000b9";
const CB = "11111111-1111-1111-1111-1111111111b9";
const JB = jeton(CLIENT_B, "b@exemple.fr", "client_invest");
const DOSSIER = { collecte: { documents: [
  { id: "avis_imposition", label: "Avis d'imposition", statut: "Demandé", commentaire: "NOTE INTERNE", required: true },
  { id: "bulletins", label: "3 derniers bulletins de salaire", statut: "Demandé" },
  { id: "rib", label: "RIB", statut: "À demander" },
  { id: "pi", label: "Pièce d'identité", statut: "Reçu" },
] }, analyse: { diagnostic: "CONFIDENTIEL" } };
const chemin = (client, id, nom = "x.pdf") => `clients/${client}/depots-client/${id}-${nom}`;

async function base() {
  const db = await nouvelleBase([LIAISON]);
  await db.exec(`alter table public.invest_clients add column if not exists telephone text;
    create table public.invest_structuration_patrimoniale (id uuid primary key default gen_random_uuid(), client_id uuid, donnees jsonb, created_at timestamptz default now());
    insert into auth.users (id, email) values ('${CLIENT_B}','b@exemple.fr');
    insert into public.invest_clients (id, prenom, nom) values ('${CB}','Bob','Client B');
    insert into public.invest_portail_comptes (client_id, auth_user_id) values ('${ID.cA}','${ID.client}'), ('${CB}','${CLIENT_B}');
    insert into public.invest_structuration_patrimoniale (client_id, donnees) values ('${ID.cA}', '${JSON.stringify(DOSSIER).replace(/'/g, "''")}'::jsonb);`);
  await db.exec(lire(DEPOTS));
  return db;
}
const depot = (db, client, statut, id, extra = "") => db.query(
  `insert into public.invest_portail_depots (id, client_id, libelle, nom_fichier, chemin, statut, taille ${extra ? "," + extra.cols : ""}) values ($1, $2, 'Avis', 'avis.pdf', $3, $4, 1000 ${extra ? "," + extra.vals : ""})`,
  [id, client, chemin(client, id), statut]);
const U1 = "aaaaaaaa-0000-0000-0000-000000000001", U2 = "aaaaaaaa-0000-0000-0000-000000000002", U3 = "aaaaaaaa-0000-0000-0000-000000000003", U4 = "aaaaaaaa-0000-0000-0000-000000000004";

// ── Règles pures ─────────────────────────────────────────────────────────────────────────────
test("1. noms de fichier : accents, espaces, séparateurs de chemin et noms vides neutralisés", () => {
  assert.equal(R.nomSur("Relevé été 2026 (copie).PDF"), "Releve-ete-2026-copie.pdf");
  assert.equal(R.nomSur("../../etc/passwd.png"), "etc-passwd.png");
  assert.equal(R.nomSur("....pdf"), "document.pdf");
  assert.ok(R.nomSur("a".repeat(300) + ".pdf").length <= 64);
  assert.ok(!/[\\/]|\.\./.test(R.nomSur("a/b\\c..d.jpg")));
});
test("2. seuls PDF, JPG et PNG, dont le type annoncé correspond à l'extension", () => {
  const ok = (nom, mime) => R.validerDemande({ nomFichier: nom, taille: 1000, mime, pieceCle: null, libelle: "x" }).ok;
  assert.ok(ok("a.pdf", "application/pdf") && ok("a.JPG", "image/jpeg") && ok("a.jpeg", "image/jpeg") && ok("a.png", "image/png"));
  assert.ok(!ok("a.exe", "application/octet-stream") && !ok("a.html", "text/html") && !ok("a.svg", "image/svg+xml") && !ok("a.pdf", "text/html") && !ok("a", "application/pdf"));
});
test("3. taille : vide et au-delà de 10 Mo refusés ; la limite elle-même passe", () => {
  const t = (taille) => R.validerDemande({ nomFichier: "a.pdf", taille, mime: "application/pdf", pieceCle: null, libelle: "x" });
  assert.ok(t(R.TAILLE_MAX).ok && !t(R.TAILLE_MAX + 1).ok && !t(0).ok && !t(-5).ok && !t("abc").ok && !t(1.5).ok);
});
test("4. pièce : seule une pièce DEMANDÉE est acceptée ; sinon un libellé libre est obligatoire", () => {
  const demandees = [{ id: "avis", label: "Avis d'imposition" }];
  const base = { nomFichier: "a.pdf", taille: 10, mime: "application/pdf", piecesDemandees: demandees };
  const a = R.validerDemande({ ...base, pieceCle: "avis" });
  assert.ok(a.ok && a.pieceCle === "avis" && a.libelle === "Avis d'imposition");
  assert.ok(!R.validerDemande({ ...base, pieceCle: "inventee" }).ok);
  assert.ok(!R.validerDemande({ ...base, pieceCle: null, libelle: "  " }).ok);
  const libre = R.validerDemande({ ...base, pieceCle: null, libelle: "Taxe foncière 2025" });
  assert.ok(libre.ok && libre.pieceCle === null && libre.libelle === "Taxe foncière 2025");
});
test("5. un client qui a déjà 25 pièces en attente ne peut plus en déposer", () => {
  const d = (n) => R.validerDemande({ nomFichier: "a.pdf", taille: 10, mime: "application/pdf", pieceCle: null, libelle: "x", depotsEnCours: n });
  assert.ok(d(24).ok && !d(25).ok);
});
test("6. signature : les premiers octets doivent correspondre au type annoncé", () => {
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31], png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], jpg = [0xff, 0xd8, 0xff, 0xe0];
  assert.ok(R.signatureValide(pdf, "pdf") && R.signatureValide(png, "png") && R.signatureValide(jpg, "jpg") && R.signatureValide(jpg, "jpeg"));
  assert.ok(!R.signatureValide(png, "pdf") && !R.signatureValide(pdf, "png") && !R.signatureValide([0x4d, 0x5a, 0x90], "pdf"), "un exécutable renommé en .pdf est refusé");
  assert.ok(!R.signatureValide([], "pdf") && !R.signatureValide(pdf, "exe"));
});
test("7. le chemin est fabriqué par le serveur dans le dossier du client", () => {
  const c = R.cheminDepot(ID.cA, U1, "a.pdf");
  assert.equal(c, `clients/${ID.cA}/depots-client/${U1}-a.pdf`);
});
// ── Fonction : l'ordre des contrôles ─────────────────────────────────────────────────────────
test("8. fonction : méthode, jeton, client de la connexion, pièces demandées, ENSUITE le service_role", () => {
  const pos = (s) => { const i = FN.indexOf(s); assert.ok(i >= 0, `absent : ${s}`); return i; };
  const ordre = [pos('req.method !== "POST"'), pos("Bearer"), pos("auth.getUser"), pos('rpc("portail_client_id")'),
    pos('rpc("portail_pieces_demandees")'), pos("validerDemande("), pos("insert({"), pos("createSignedUploadUrl")];
  assert.deepEqual([...ordre].sort((a, b) => a - b), ordre, "ordre des contrôles");
  const premierService = FN.indexOf("createClient(url, cleService");
  assert.ok(premierService > pos('rpc("portail_client_id")'), "le service_role n'existe qu'après l'identification du client");
});
test("9. fonction : le client n'envoie jamais d'identifiant de client ni de chemin ; un fichier non conforme est supprimé", () => {
  assert.ok(!/corps\??\.(client_?id|clientId|chemin|path)/.test(FN), "ni client ni chemin pris dans la requête");
  assert.match(FN, /cheminDepot\(clientId, depotId, v\.nomSur\)/);
  assert.match(FN, /signatureValide\(octets\.slice\(0, 16\), ext\)/);
  assert.match(FN, /storage\.from\(BUCKET\)\.remove\(\[depot\.chemin\]\)/);
  assert.match(FN, /\.eq\("client_id", clientId\)\.eq\("statut", "en_attente_fichier"\)/, "la confirmation ne touche que les dépôts du client en attente");
  assert.ok(!/SERVICE_ROLE.*return json|json\(\{[^}]*cleService/.test(FN), "la clé de service n'est jamais renvoyée");
});
test("10. configuration : la fonction exige un jeton (verify_jwt = true)", () => {
  assert.match(lire("supabase/config.toml"), /\[functions\.portail-depot-document\]\s*\nverify_jwt = true/);
});
// ── Base ─────────────────────────────────────────────────────────────────────────────────────
test("11. le client voit ses dépôts (sans le chemin du fichier), pas ceux d'un autre, pas ceux en attente du fichier", async () => {
  const db = await base();
  await depot(db, ID.cA, "a_verifier", U1); await depot(db, ID.cA, "en_attente_fichier", U2); await depot(db, ID.cA, "refuse", U3, { cols: "motif", vals: "'Illisible'" }); await depot(db, CB, "a_verifier", U4);
  const v = await sous(db, "authenticated", J.client, `select * from public.portail_depots order by statut`);
  assert.deepEqual(v.rows.map((r) => r.statut).sort(), ["a_verifier", "refuse"]);
  assert.ok(v.rows.every((r) => !("chemin" in r) && !("client_id" in r)));
  assert.equal(v.rows.find((r) => r.statut === "refuse").motif, "Illisible");
  const b = await sous(db, "authenticated", JB, `select statut from public.portail_depots`);
  assert.deepEqual(b.rows.map((r) => r.statut), ["a_verifier"]);
});
test("12. le client n'a aucun accès direct à la table ; ni lui ni un anonyme ne peuvent accepter un dépôt", async () => {
  const db = await base(); await depot(db, ID.cA, "a_verifier", U1);
  assert.equal((await sous(db, "authenticated", J.client, `select * from public.invest_portail_depots`)).rows.length, 0);
  for (const sql of [`update public.invest_portail_depots set statut = 'accepte'`, `delete from public.invest_portail_depots`,
    `insert into public.invest_portail_depots (client_id, libelle, nom_fichier, chemin) values ('${ID.cA}','x','x.pdf','clients/${ID.cA}/depots-client/z-x.pdf')`]) {
    const r = await sous(db, "authenticated", J.client, sql); assert.ok(r.erreur || r.rows.length === 0, sql);
  }
  assert.ok((await sous(db, "anon", {}, `select * from public.portail_depots`)).erreur);
  assert.equal((await db.query(`select statut from public.invest_portail_depots`)).rows[0].statut, "a_verifier");
});
test("13. la base refuse un chemin hors du dossier du client, un chemin avec « .. », une taille de plus de 10 Mo, un statut inconnu", async () => {
  const db = await base();
  const ins = (chemin_, extra = "", statut = "a_verifier") => db.query(`insert into public.invest_portail_depots (client_id, libelle, nom_fichier, chemin, statut ${extra ? ", taille" : ""}) values ('${ID.cA}','x','x.pdf',$1,$2 ${extra ? "," + extra : ""})`, [chemin_, statut]);
  await ins(chemin(ID.cA, U1));
  await assert.rejects(ins(chemin(CB, U2)), "dossier d'un autre client");
  await assert.rejects(ins(`clients/${ID.cA}/depots-client/../autre.pdf`), "remontée de dossier");
  await assert.rejects(ins(`clients/${ID.cA}/autre-dossier/x.pdf`), "hors du sous-dossier des dépôts");
  await assert.rejects(ins(chemin(ID.cA, U3), "10485761"), "trop gros");
  await assert.rejects(ins(chemin(ID.cA, U4), "", "nimporte"), "statut inconnu");
});
test("14. les pièces demandées : seulement le statut « Demandé », identifiant et libellé uniquement, jamais les notes ni les analyses", async () => {
  const db = await base();
  const r = (await sous(db, "authenticated", J.client, `select public.portail_pieces_demandees() as p`)).rows[0].p;
  assert.deepEqual(r.map((x) => x.id).sort(), ["avis_imposition", "bulletins"]);
  assert.ok(r.every((x) => Object.keys(x).sort().join() === "id,label"));
  const t = JSON.stringify(r); assert.ok(!t.includes("NOTE INTERNE") && !t.includes("CONFIDENTIEL") && !t.includes("RIB") && !t.includes("identité"));
  assert.deepEqual((await sous(db, "authenticated", JB, `select public.portail_pieces_demandees() as p`)).rows[0].p, [], "client sans dossier : liste vide");
  assert.ok((await sous(db, "authenticated", J.admin, `select public.portail_pieces_demandees()`)).erreur, "refusé sans lien");
  assert.ok((await sous(db, "authenticated", J.commercialFalsifie, `select public.portail_pieces_demandees()`)).erreur);
});
test("15. le collaborateur lit et traite les dépôts (accepter, refuser) ; il n'insère ni ne supprime", async () => {
  const db = await base(); await depot(db, ID.cA, "a_verifier", U1);
  const lu = await sous(db, "authenticated", J.commercial, `select chemin from public.invest_portail_depots`);
  assert.equal(lu.rows.length, 1);
  const maj = await sous(db, "authenticated", J.commercial, `update public.invest_portail_depots set statut='refuse', motif='Illisible', traite_par='Commercial', traite_le=now() returning statut`);
  assert.equal(maj.rows[0].statut, "refuse");
  const sup = await sous(db, "authenticated", J.commercial, `delete from public.invest_portail_depots returning id`);
  assert.ok(sup.erreur || sup.rows.length === 0);
  assert.ok((await sous(db, "authenticated", J.ouvrier, `select * from public.invest_portail_depots`)).rows.length === 0, "un ouvrier ne voit rien");
});
test("16. retour arrière : tout disparaît proprement", async () => {
  const db = await base(); await db.exec(ROLLBACK);
  const o = await db.query(`select (select count(*) from pg_proc where proname = 'portail_pieces_demandees')::int f, (select count(*) from pg_class where relname in ('invest_portail_depots','portail_depots'))::int t`);
  assert.deepEqual(o.rows[0], { f: 0, t: 0 });
});

await lancer();
