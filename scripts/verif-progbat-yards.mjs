#!/usr/bin/env node
// Vérifie le rattachement « chantier ProGBat → chantier Profero » :
//   1. la migration sql/202609_chantier_progbat_yards.sql (analyse statique) ;
//   2. les règles pures de l'Edge Function progbat-yards-list
//      (src/Renovation/progbatYards.mjs + analyse statique de index.ts) ;
//   3. la résolution d'une facture dans src/Renovation/progbatLiaison.mjs.
//
// Aucun appel réseau, aucune base : l'API ProGBat réelle n'est jamais touchée
// et aucune migration n'est exécutée. La partie SQL est une analyse de TEXTE —
// c'est le seul contrôle possible sans base locale, et il attrape ce qui compte
// ici : une contrainte oubliée, un grant à anon, une policy manquante.
//   node scripts/verif-progbat-yards.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ═══════════════════════════════════════════════════════════════════════════
// 1. MIGRATION — analyse statique
// ═══════════════════════════════════════════════════════════════════════════
const SQL = lire("sql/202609_chantier_progbat_yards.sql");
// Version sans commentaires : une règle « présente » dans un commentaire
// n'existe pas en base. Tous les contrôles ci-dessous portent sur le code.
const SQL_CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

test("migration : unicité du chantier ProGBat, et elle seule", () => {
  assert.match(SQL_CODE, /add constraint chantier_progbat_yards_yard_unique unique \(progbat_yard_id\)/);
  // Un chantier Profero peut recevoir PLUSIEURS yards : tout unique touchant
  // chantier_id casserait la règle métier.
  assert.doesNotMatch(SQL_CODE, /unique[^\n]*\(\s*chantier_id/i);
  assert.doesNotMatch(SQL_CODE, /create unique index[^\n]*chantier_id/i);
});

test("migration : chantier_id non vide, yard strictement positif", () => {
  assert.match(SQL_CODE, /check \(btrim\(chantier_id\) <> ''\)/);
  assert.match(SQL_CODE, /check \(progbat_yard_id > 0\)/);
  assert.match(SQL_CODE, /chantier_id\s+text\s+not null/);
  assert.match(SQL_CODE, /progbat_yard_id\s+bigint\s+not null/);
});

test("migration : cree_par par défaut, horodatages, colonne publique nullable", () => {
  assert.match(SQL_CODE, /cree_par\s+uuid\s+not null default auth\.uid\(\)/);
  assert.match(SQL_CODE, /created_at\s+timestamptz not null default now\(\)/);
  assert.match(SQL_CODE, /updated_at\s+timestamptz not null default now\(\)/);
  // publicYardNumber vaut null sur toutes les données réelles : la colonne ne
  // doit surtout pas être not null.
  assert.match(SQL_CODE, /progbat_public_yard_number text(?!\s+not null)/);
});

test("migration : index sur chantier_id", () => {
  assert.match(SQL_CODE, /create index if not exists chantier_progbat_yards_chantier_idx\s*\n?\s*on public\.chantier_progbat_yards \(chantier_id\)/);
});

test("migration : aucune clé étrangère (ni chantier, ni ProGBat)", () => {
  assert.doesNotMatch(SQL_CODE, /references/i);
  assert.doesNotMatch(SQL_CODE, /foreign key/i);
});

test("migration : RLS bureau, anon révoqué, grants explicites", () => {
  assert.match(SQL_CODE, /alter table public\.chantier_progbat_yards enable row level security/);
  assert.match(SQL_CODE, /for all to authenticated/);
  assert.match(SQL_CODE, /using \(not public\.est_ouvrier\(\)\) with check \(not public\.est_ouvrier\(\)\)/);
  assert.match(SQL_CODE, /revoke all on table public\.chantier_progbat_yards from public, anon/);
  assert.match(SQL_CODE, /grant select, insert, update, delete on table public\.chantier_progbat_yards to authenticated/);
  // L'ordre compte : un revoke placé APRÈS le grant annulerait le grant.
  assert.ok(SQL_CODE.indexOf("revoke all on table") < SQL_CODE.indexOf("grant select, insert"),
    "le revoke doit précéder le grant");
});

test("migration : triggers data_history et set_updated_at, sous garde", () => {
  assert.match(SQL_CODE, /trg_data_history on public\.chantier_progbat_yards/);
  assert.match(SQL_CODE, /execute function public\.log_data_history\(\)/);
  assert.match(SQL_CODE, /chantier_progbat_yards_set_updated_at/);
  assert.match(SQL_CODE, /execute function public\.set_updated_at\(\)/);
  // Gardes : la fonction commune doit exister, et la colonne updated_at aussi.
  assert.match(SQL_CODE, /proname = 'log_data_history'/);
  assert.match(SQL_CODE, /proname = 'set_updated_at'/);
  assert.match(SQL_CODE, /column_name = 'updated_at'/);
});

test("migration : rejouable, et sans écriture des données existantes", () => {
  assert.match(SQL_CODE, /create table if not exists public\.chantier_progbat_yards/);
  assert.match(SQL_CODE, /create index if not exists/);
  assert.match(SQL_CODE, /drop policy if exists/);
  assert.match(SQL_CODE, /drop trigger if exists/);
  // Chaque contrainte est posée sous un garde `if not exists (... pg_constraint ...)`.
  const contraintes = [...SQL_CODE.matchAll(/add constraint (\w+)/g)].map((m) => m[1]);
  assert.equal(contraintes.length, 3, "3 contraintes attendues");
  for (const c of contraintes) {
    assert.ok(new RegExp(`conname = '${c}'`).test(SQL_CODE), `${c} doit être posée sous garde`);
  }
  // Aucune modification de l'existant, et surtout pas de chantier_projets qui
  // reste le chemin de repli. On regarde les DÉBUTS d'instruction : « before
  // update or delete on » dans un trigger n'est pas une écriture de données.
  for (const i of SQL_CODE.split(";").map((x) => x.trim().toLowerCase())) {
    assert.ok(!/^(update|delete\s+from|truncate|drop\s+table)\b/.test(i),
      `instruction destructrice : ${i.slice(0, 60)}`);
  }
  assert.doesNotMatch(SQL_CODE, /alter table public\.chantier_projets/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. EDGE FUNCTION progbat-yards-list
// ═══════════════════════════════════════════════════════════════════════════
const yardsMod = await import(new URL("../src/Renovation/progbatYards.mjs", import.meta.url).href);
const { PAGE_SIZE, MAX_PAGES, CHAMPS_YARD, projeterYard, trierYards, parcourirYards, choisirJeton } = yardsMod;

const INDEX_TS = lire("supabase/functions/progbat-yards-list/index.ts");
// Version sans les commentaires : une règle expliquée en commentaire n'est pas
// une règle appliquée, et un mot interdit cité dans un commentaire n'est pas
// une fuite. Les contrôles « ne contient pas » portent sur INDEX_CODE.
const INDEX_CODE = INDEX_TS.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

// Fabrique une doublure de lecture paginée à partir d'une liste de yards.
function pagesDe(yards, { pageSize = PAGE_SIZE } = {}) {
  const appels = [];
  return {
    appels,
    lire: async ({ limit, offset }) => {
      appels.push({ limit, offset });
      return { ok: true, data: yards.slice(offset, offset + Math.min(limit, pageSize)) };
    },
  };
}
const yardBrut = (id, extra = {}) => ({
  id, label: `Chantier ${String(id).padStart(3, "0")}`, publicYardNumber: null, ...extra,
});

test("edge : le jeton de facturation est prioritaire", () => {
  assert.deepEqual(choisirJeton({ billing: "B", legacy: "L" }), { token: "B", source: "billing" });
});

test("edge : repli sur le jeton historique SEULEMENT si le secret dédié est absent", () => {
  assert.deepEqual(choisirJeton({ billing: "", legacy: "L" }), { token: "L", source: "legacy" });
  assert.deepEqual(choisirJeton({ billing: "   ", legacy: "L" }), { token: "L", source: "legacy" });
  assert.deepEqual(choisirJeton({ billing: "", legacy: "" }), { token: "", source: null });
  // Le repli ne doit PAS être déclenché par un échec : aucun second appel
  // ProGBat après une réponse refusée.
  assert.doesNotMatch(INDEX_CODE, /PROGBAT_PRIVATE_ACCESS_TOKEN[\s\S]{0,400}(403|retry|réessay)/i);
  // Le secret n'est lu qu'une fois, au moment du choix : pas de relecture
  // ailleurs dans le flux qui pourrait servir de seconde tentative.
  assert.equal((INDEX_CODE.match(/PROGBAT_PRIVATE_ACCESS_TOKEN/g) || []).length, 1);
});

test("edge : GET uniquement, et un seul endpoint", () => {
  const methodes = [...INDEX_CODE.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(methodes)], ["GET"], "seule la méthode GET est utilisée vers ProGBat");
  const chemins = [...INDEX_CODE.matchAll(/\$\{PROGBAT_API\}([^`]*)/g)].map((m) => m[1]);
  assert.equal(chemins.length, 1);
  assert.match(chemins[0], /^\/company\/yards\?limit=/);
  // Aucune écriture ProGBat ni Supabase.
  assert.doesNotMatch(INDEX_CODE, /\.(insert|update|upsert|delete)\(/);
});

test("edge : pagination jusqu'à la fin réelle, pas d'arrêt anticipé", async () => {
  const p = pagesDe(Array.from({ length: 250 }, (_, i) => yardBrut(i + 1)));
  const r = await parcourirYards(p.lire);
  assert.equal(r.ok, true);
  assert.equal(r.yards.length, 250);
  assert.equal(r.complet, true);
  assert.equal(r.pages, 3);           // 100 + 100 + 50
  assert.deepEqual(p.appels.map((a) => a.offset), [0, 100, 200]);
  // L'arrêt ne s'appuie jamais sur Content-Range.
  assert.doesNotMatch(INDEX_CODE, /content-range/i);
});

test("edge : plus de 100 chantiers, lus sur deux pages", async () => {
  const p = pagesDe(Array.from({ length: 110 }, (_, i) => yardBrut(i + 1)));
  const r = await parcourirYards(p.lire);
  assert.equal(r.yards.length, 110);
  assert.equal(r.pages, 2);
  assert.equal(r.complet, true);
});

test("edge : dernière page exactement pleine → une page de plus, puis fin", async () => {
  const p = pagesDe(Array.from({ length: 200 }, (_, i) => yardBrut(i + 1)));
  const r = await parcourirYards(p.lire);
  assert.equal(r.yards.length, 200);
  assert.equal(r.pages, 3, "une page vide confirme la fin de liste");
  assert.equal(r.complet, true);
});

test("edge : déduplication par id", async () => {
  const lire = async ({ offset }) => ({
    ok: true,
    data: offset === 0
      ? [yardBrut(7), yardBrut(8), yardBrut(7)]         // doublon dans la page
      : [],
  });
  const r = await parcourirYards(lire, { pageSize: 3 });
  assert.deepEqual(r.yards.map((y) => y.id), [7, 8]);

  // Doublon ENTRE deux pages (la liste a bougé) : le dernier vu gagne.
  const lire2 = async ({ offset }) => ({
    ok: true,
    data: offset === 0
      ? [yardBrut(1), yardBrut(2)]
      : offset === 2 ? [yardBrut(2, { label: "Renommé" })] : [],
  });
  const r2 = await parcourirYards(lire2, { pageSize: 2 });
  assert.equal(r2.yards.length, 2);
  assert.equal(r2.yards.find((y) => y.id === 2).label, "Renommé");
});

test("edge : tri par libellé puis par id, sans-libellé en dernier", async () => {
  const lire = async ({ offset }) => ({
    ok: true,
    data: offset === 0 ? [
      { id: 9, label: "Zola" },
      { id: 4, label: "école Jean Moulin" },   // accents et casse ignorés au tri
      { id: 2, label: null },
      { id: 7, label: "Zola" },                 // homonyme : départage par id
      { id: 1, label: "Écoles (autre)" },
    ] : [],
  });
  const r = await parcourirYards(lire, { pageSize: 10 });
  assert.deepEqual(r.yards.map((y) => y.id), [4, 1, 7, 9, 2]);
  // Tri stable : rejouer le tri ne change rien.
  assert.deepEqual(trierYards(r.yards).map((y) => y.id), [4, 1, 7, 9, 2]);
});

test("edge : garde MAX_PAGES, largement au-dessus des 110 chantiers actuels", async () => {
  assert.ok(MAX_PAGES * PAGE_SIZE >= 4000, "la garde doit laisser une marge très large");
  let appels = 0;
  const infinie = async ({ limit, offset }) => {
    appels++;
    return { ok: true, data: Array.from({ length: limit }, (_, i) => yardBrut(offset + i + 1)) };
  };
  const r = await parcourirYards(infinie, { pageSize: 10, maxPages: 5 });
  assert.equal(appels, 5, "la boucle s'arrête à la garde");
  assert.equal(r.garde_atteinte, true);
  assert.equal(r.complet, false);
  // Et la fonction refuse de présenter une liste tronquée comme complète.
  assert.match(INDEX_TS, /garde_atteinte/);
});

test("edge : liste blanche stricte — rien d'autre ne sort", () => {
  assert.deepEqual([...CHAMPS_YARD], ["id", "businessId", "label", "publicYardNumber"]);
  const projete = projeterYard({
    id: 77, businessId: 5, label: "Résidence Les Tilleuls", publicYardNumber: "C-77",
    managerId: 12, address: "12 rue des Lilas", postcode: "49000", city: "Angers",
    clientName: "Dupont", clientEmail: "dupont@example.com", phone: "0600000000",
    startDate: "2026-01-01", color: "#ff0000", holdbackDuration: 12,
  });
  assert.deepEqual(Object.keys(projete).sort(), ["businessId", "id", "label", "publicYardNumber"]);
  assert.deepEqual(projete, { id: 77, businessId: 5, label: "Résidence Les Tilleuls", publicYardNumber: "C-77" });
  // publicYardNumber réellement observé : null.
  assert.equal(projeterYard({ id: 3, label: "X", publicYardNumber: null }).publicYardNumber, null);
  // Un yard sans identifiant exploitable n'est pas rattachable : écarté.
  for (const mauvais of [{ id: 0 }, { id: -1 }, { id: "abc" }, { id: null }, { id: 1.5 }, {}]) {
    assert.equal(projeterYard(mauvais), null, `id ${JSON.stringify(mauvais)} doit être écarté`);
  }
});

test("edge : businessId (code affiché par ProGBat) sort, sans jamais remplacer id", () => {
  // Cas réel : ProGBat affiche « #80 TROTIER - T3 - RDC », l'API renvoie
  // businessId 80 et id 83. Les deux doivent survivre à la projection, chacun
  // à sa place — c'est id, et lui seul, que portent les factures.
  const y = projeterYard({ id: 83, businessId: 80, label: "T3 - RDC", publicYardNumber: null });
  assert.deepEqual(y, { id: 83, businessId: 80, label: "T3 - RDC", publicYardNumber: null });
  // businessId en texte : ProGBat renvoie parfois des nombres en chaîne.
  assert.equal(projeterYard({ id: 83, businessId: "80" }).businessId, 80);
  // businessId inexploitable → null, mais le yard reste rattachable.
  for (const mauvais of [0, -1, 1.5, "abc", "", null, undefined, {}, []]) {
    const p = projeterYard({ id: 83, businessId: mauvais, label: "T3 - RDC" });
    assert.equal(p.businessId, null, `businessId ${JSON.stringify(mauvais)} doit devenir null`);
    assert.equal(p.id, 83, "l'id technique n'est jamais remplacé par businessId");
  }
});

test("edge : businessId ne sert JAMAIS à résoudre une facture", () => {
  // La résolution facture → chantier ne connaît que yardId et quoteId. Si
  // businessId y entrait, deux chantiers pourraient se disputer une facture.
  const LIAISON = lire("src/Renovation/progbatLiaison.mjs");
  assert.doesNotMatch(LIAISON, /businessId/);
  // Et rien ne l'écrit dans la table de rattachement.
  assert.doesNotMatch(lire("sql/202609_chantier_progbat_yards.sql"), /business_id/);
});

test("edge : aucune fuite de jeton ni de données interdites dans la réponse", async () => {
  const r = await parcourirYards(async ({ offset }) => ({
    ok: true,
    data: offset === 0 ? [{ id: 1, label: "A", clientEmail: "x@y.z", address: "secret", managerId: 9 }] : [],
  }), { pageSize: 5 });
  const rendu = JSON.stringify({ ok: true, nombre: r.yards.length, yards: r.yards });
  // businessId n'est PAS dans cette liste : c'est le code que ProGBat affiche
  // lui-même à l'écran, volontairement exposé depuis le 16/09/2026. Tout le
  // reste — client, adresse, téléphone, responsable — reste interdit.
  for (const interdit of ["clientEmail", "address", "managerId", "secret", "x@y.z"]) {
    assert.ok(!rendu.includes(interdit), `${interdit} ne doit pas sortir`);
  }
  // Le code lui-même ne renvoie ni jeton ni corps brut.
  // `token` en minuscules = la VALEUR du secret. Sans le drapeau /i, pour que
  // le NOM du secret (PROGBAT_BILLING_ACCESS_TOKEN) reste citable dans un
  // message d'erreur : nommer la variable à configurer n'est pas la divulguer.
  assert.doesNotMatch(INDEX_CODE, /json\(\{[^}]*\btoken\b/);
  assert.doesNotMatch(INDEX_CODE, /console\.(log|warn|error)\([^)]*\btoken\b[^)]*\)/);
  assert.match(INDEX_TS, /nettoyerMessage/, "les messages d'erreur sont nettoyés");
  assert.match(INDEX_TS, /\[A-Za-z0-9_\\-\.\]\{24,\}/, "les séquences ressemblant à un jeton sont masquées");
});

test("edge : 403 contextualisé business.read, sans second essai", async () => {
  let appels = 0;
  const refus = async () => { appels++; return { ok: false, status: 403, message: "Accès refusé par ProGBat (403) : le jeton n'a pas le scope requis (business.read) pour lire les chantiers." }; };
  const r = await parcourirYards(refus, { pageSize: 10, maxPages: 5 });
  assert.equal(appels, 1, "aucun second essai après un refus");
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.match(r.message, /business\.read/);
  assert.equal(r.complet, false);
  assert.equal(r.garde_atteinte, false);
  // Le code HTTP renvoyé au client conserve le 403.
  assert.match(INDEX_TS, /lu\.status === 401 \|\| lu\.status === 403/);
  assert.match(INDEX_TS, /SCOPE_ATTENDU = "business\.read"/);
});

test("edge : appelant authentifié et non-ouvrier", () => {
  assert.match(INDEX_TS, /Non authentifié/);
  assert.match(INDEX_TS, /profil\.role === "ouvrier"/);
  assert.match(INDEX_TS, /profil\.actif === false/);
  assert.match(INDEX_TS, /401\)/);
  assert.match(INDEX_TS, /403\)/);
});

test("edge : la copie lib/ est à jour", async () => {
  const { verifierCopies } = await import(new URL("../scripts/sync-progbat-edge-lib.mjs", import.meta.url).href);
  assert.deepEqual(verifierCopies(), [], "node scripts/sync-progbat-edge-lib.mjs");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. RÉSOLUTION facture → chantier
// ═══════════════════════════════════════════════════════════════════════════
const liaison = await import(new URL("../src/Renovation/progbatLiaison.mjs", import.meta.url).href);
const { RESOLUTION, SOURCE, resoudreChantierDepuisFacture, resoudreLot } = liaison;

const P1 = "aaaaaaaa-0000-0000-0000-000000000001";
const P2 = "aaaaaaaa-0000-0000-0000-000000000002";
// Contexte de référence : le yard 77 et le yard 78 sont sur « tilleuls ».
const CTX = {
  yards: [
    { progbat_yard_id: 77, chantier_id: "tilleuls" },
    { progbat_yard_id: 78, chantier_id: "tilleuls" },   // un chantier = N yards
    { progbat_yard_id: 90, chantier_id: "acacias" },
  ],
  exports: [
    { progbat_quote_id: 451, projet_id: P1 },
    { progbat_quote_id: 452, projet_id: P1 },           // avenant : même logement
    { progbat_quote_id: 500, projet_id: P2 },
  ],
  liaisons: [
    { projet_id: P1, chantier_id: "tilleuls" },
    { projet_id: P2, chantier_id: "acacias" },
  ],
};

test("résolution A : yard rattaché → chantier, source yard", () => {
  const r = resoudreChantierDepuisFacture({ id: 1, yardId: 77, quoteId: 451 }, CTX);
  assert.equal(r.statut, RESOLUTION.RESOLU);
  assert.equal(r.resolu, true);
  assert.equal(r.chantier_id, "tilleuls");
  assert.equal(r.source, SOURCE.YARD);
  assert.equal(r.yard_id, 77);
});

test("résolution : deux devis différents sur le même yard donnent le même chantier", () => {
  const a = resoudreChantierDepuisFacture({ yardId: 77, quoteId: 451 }, CTX);
  const b = resoudreChantierDepuisFacture({ yardId: 77, quoteId: 452 }, CTX);
  assert.equal(a.chantier_id, "tilleuls");
  assert.equal(b.chantier_id, "tilleuls");
  assert.equal(b.source, SOURCE.YARD);
  // Et un devis totalement inconnu ne empêche pas la résolution par le yard.
  const c = resoudreChantierDepuisFacture({ yardId: 77, quoteId: 999999 }, CTX);
  assert.equal(c.statut, RESOLUTION.RESOLU);
  assert.equal(c.chantier_id, "tilleuls");
});

test("résolution B : yard positif non rattaché → jamais de repli silencieux", () => {
  // Le devis 500 mènerait à « acacias ». Il ne doit PAS être utilisé.
  const r = resoudreChantierDepuisFacture({ yardId: 12345, quoteId: 500 }, CTX);
  assert.equal(r.statut, RESOLUTION.YARD_NON_RATTACHE);
  assert.equal(r.resolu, false);
  assert.equal(r.chantier_id, null);
  assert.equal(r.source, null);
  assert.equal(r.yard_id, 12345);
  // Le chantier du devis n'est qu'une SUGGESTION.
  assert.equal(r.suggestion_chantier_id, "acacias");
  assert.match(r.raison, /12345/);
});

test("résolution C : yardId = 0 → repli par le devis", () => {
  const r = resoudreChantierDepuisFacture({ yardId: 0, quoteId: 500 }, CTX);
  assert.equal(r.statut, RESOLUTION.RESOLU);
  assert.equal(r.resolu, true);
  assert.equal(r.chantier_id, "acacias");
  assert.equal(r.source, SOURCE.QUOTE_FALLBACK);
  assert.equal(r.yard_id, null);
  assert.equal(r.projet_id, P2);
});

test("résolution C : yardId absent et devis introuvable → issue explicite, pas de résolution", () => {
  const sansYard = { quoteId: 777 };
  const r = resoudreChantierDepuisFacture(sansYard, CTX);
  assert.equal(r.statut, RESOLUTION.DEVIS_INCONNU);
  assert.equal(r.resolu, false);
  assert.equal(r.source, null);

  const rien = resoudreChantierDepuisFacture({ yardId: null, quoteId: 0 }, CTX);
  assert.equal(rien.statut, RESOLUTION.QUOTE_ABSENT);
  assert.equal(rien.resolu, false);

  // Logement connu mais rattaché à aucun chantier : l'issue existante est gardée.
  const orphelin = resoudreChantierDepuisFacture({ quoteId: 451 }, { ...CTX, liaisons: [] });
  assert.equal(orphelin.statut, RESOLUTION.PROJET_NON_RATTACHE);
  assert.equal(orphelin.projet_id, P1);
});

test("résolution : quoteId = 0 avec un yard valide → résolu par le yard", () => {
  const r = resoudreChantierDepuisFacture({ yardId: 77, quoteId: 0 }, CTX);
  assert.equal(r.statut, RESOLUTION.RESOLU);
  assert.equal(r.chantier_id, "tilleuls");
  assert.equal(r.source, SOURCE.YARD);
  assert.equal(r.quote_id, null);
});

test("résolution D : conflit yard / devis → aucun choix, les deux chantiers sont rendus", () => {
  // Yard 77 → « tilleuls » ; devis 500 → « acacias ».
  const r = resoudreChantierDepuisFacture({ yardId: 77, quoteId: 500 }, CTX);
  assert.equal(r.statut, RESOLUTION.CONFLIT);
  assert.equal(r.resolu, false);
  assert.equal(r.chantier_id, null, "aucun chantier n'est choisi en silence");
  assert.equal(r.chantier_id_yard, "tilleuls");
  assert.equal(r.chantier_id_quote, "acacias");
  assert.equal(r.source, null);
});

test("résolution E : les deux chemins donnent le même chantier → résolu par yard", () => {
  const r = resoudreChantierDepuisFacture({ yardId: 78, quoteId: 451 }, CTX);
  assert.equal(r.statut, RESOLUTION.RESOLU);
  assert.equal(r.chantier_id, "tilleuls");
  assert.equal(r.source, SOURCE.YARD);
  assert.equal(r.chantier_id_quote, "tilleuls");
});

test("résolution : identifiants négatifs, décimaux ou textuels refusés", () => {
  // Côté facture : un yardId invalide bascule sur le repli (cas C), il ne
  // « trouve » jamais un yard.
  for (const mauvais of [-1, -77, 1.5, "abc", "", "  ", true, {}, []]) {
    const r = resoudreChantierDepuisFacture({ yardId: mauvais, quoteId: 500 }, CTX);
    assert.equal(r.yard_id, null, `yardId ${JSON.stringify(mauvais)} doit être écarté`);
    assert.equal(r.source, SOURCE.QUOTE_FALLBACK);
    assert.equal(r.chantier_id, "acacias");
  }
  // Côté rattachement : une ligne au yard invalide ne peut capturer personne.
  const pourri = { yards: [{ progbat_yard_id: "77 ", chantier_id: "x" }, { progbat_yard_id: 0, chantier_id: "zero" }], exports: [], liaisons: [] };
  assert.equal(resoudreChantierDepuisFacture({ yardId: 0 }, pourri).statut, RESOLUTION.QUOTE_ABSENT);
  // Un chantier_id vide dans le rattachement ne résout pas non plus.
  const vide = { yards: [{ progbat_yard_id: 77, chantier_id: "" }], exports: [], liaisons: [] };
  assert.equal(resoudreChantierDepuisFacture({ yardId: 77 }, vide).statut, RESOLUTION.YARD_NON_RATTACHE);
  // Un identifiant textuel bien formé reste accepté (ProGBat type en entier,
  // mais un JSON peut le porter en chaîne).
  assert.equal(resoudreChantierDepuisFacture({ yardId: "77" }, CTX).chantier_id, "tilleuls");
});

test("résolution : jamais de rapprochement par libellé, nom, client ou montant", () => {
  const source = lire("src/Renovation/progbatLiaison.mjs");
  const code = source.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
  for (const interdit of ["label", "nom", "client", "adresse", "address", "montant", "total"]) {
    assert.ok(!new RegExp(`\\b${interdit}\\b`, "i").test(code), `${interdit} ne doit pas apparaître dans le code`);
  }
  // Un yard au libellé identique mais à l'id différent ne résout rien.
  const r = resoudreChantierDepuisFacture({ yardId: 12345, label: "Résidence Les Tilleuls" }, CTX);
  assert.equal(r.statut, RESOLUTION.YARD_NON_RATTACHE);
});

test("lot : comptage par issue, sur des factures complètes", () => {
  const lot = resoudreLot([
    { id: 1, yardId: 77, quoteId: 451 },   // résolu par yard
    { id: 2, yardId: 0, quoteId: 500 },    // repli devis
    { id: 3, yardId: 12345, quoteId: 0 },  // yard non rattaché
    { id: 4, yardId: 77, quoteId: 500 },   // conflit
  ], CTX);
  assert.equal(lot.resolus, 2);
  assert.equal(lot.non_resolus, 2);
  assert.deepEqual(lot.par_statut, { resolu: 2, yard_non_rattache: 1, conflit: 1 });
  assert.deepEqual(lot.resultats.map((r) => r.bill_id), [1, 2, 3, 4]);
  assert.deepEqual(lot.resultats.map((r) => r.source), [SOURCE.YARD, SOURCE.QUOTE_FALLBACK, null, null]);
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try {
    await fn();
    console.log(`  ok   ${nom}`);
  } catch (e) {
    echecs++;
    console.error(`  ÉCHEC ${nom}\n        ${String(e?.message || e).split("\n").join("\n        ")}`);
  }
}
console.log(`\nverif-progbat-yards : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
