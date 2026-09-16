#!/usr/bin/env node
// Vérifie le DIAGNOSTIC DE PRÉ-SYNCHRONISATION ProGBat :
//   1. les règles pures de src/Renovation/progbatBillingDryRun.mjs, branchées
//      sur des doublures (aucun réseau, aucune base, aucune écriture) ;
//   2. l'Edge Function supabase/functions/progbat-billing-dry-run/index.ts, par
//      analyse statique — c'est le seul contrôle possible sans déployer, et il
//      attrape ce qui compte ici : une écriture Supabase, un verbe autre que
//      GET, une authentification relâchée, un jeton journalisé.
//
// Aucun appel à l'API ProGBat réelle, aucune migration exécutée, aucun
// déploiement. Rien n'est écrit nulle part.
//   node scripts/verif-progbat-billing-dry-run.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const {
  MAX_EXEMPLES, MAX_PAGES, PAGE_SIZE, TRI_FACTURES, TRI_TRANSACTIONS,
  CHAMPS_EXEMPLE_FACTURE, CHAMPS_EXEMPLE_REGLEMENT, CHAMPS_COMPARES_FACTURE,
  CHAMPS_VOLATILS_FACTURE, CATEGORIES_FACTURE, CATEGORIES_REGLEMENT,
  analyserFactures, analyserReglements, executerDryRun, entierStrict,
  lireRessourceProgbat, memeValeur, transactionActive,
} = await import(new URL("../src/Renovation/progbatBillingDryRun.mjs", import.meta.url).href);

const { choisirJeton } = await import(new URL("../src/Renovation/progbatYards.mjs", import.meta.url).href);
const { normaliserFactureProgbat, fusionnerFactureProgbat } =
  await import(new URL("../src/Renovation/progbatFacturation.mjs", import.meta.url).href);

const INDEX_TS = lire("supabase/functions/progbat-billing-dry-run/index.ts");
// Version sans commentaires : une garantie « présente » dans un commentaire
// n'existe pas à l'exécution.
const INDEX_CODE = INDEX_TS.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES — un jeu de données qui contient exactement un cas de chaque issue
// ═══════════════════════════════════════════════════════════════════════════
const P1 = "aaaaaaaa-0000-0000-0000-000000000001";
const P2 = "aaaaaaaa-0000-0000-0000-000000000002";
const CONTEXTE = {
  yards: [
    { progbat_yard_id: 77, chantier_id: "tilleuls" },
    { progbat_yard_id: 90, chantier_id: "acacias" },
  ],
  exports: [
    { project_id: P1, progbat_quote_id: 451 },
    { project_id: P2, progbat_quote_id: 500 },
  ],
  liaisons: [
    { projet_id: P1, chantier_id: "tilleuls" },
    { projet_id: P2, chantier_id: "acacias" },
  ],
};

const MAINTENANT = "2026-09-16T08:00:00.000Z";

// Champs nominatifs que ProGBat renvoie réellement sur /company/bills et
// /company/transactions : ils sont mis DANS les fixtures pour vérifier qu'ils
// ne ressortent nulle part.
const NOMINATIF = {
  clientName: "SCI DUPONT-MARTIN",
  clientAddress: "12 rue des Lilas",
  clientPostcode: "69100",
  clientCity: "Villeurbanne",
  clientEmail: "compta@sci-dupont.example",
  clientPhone: "0600000000",
  thirdId: 4242,
  content: [{ label: "Dépose cloison", quantity: 3, price: 120 }],
};
const BANCAIRE = { bankAccountId: 7, label: "VIR SEPA SCI DUPONT", paymentNumber: "CHQ-0099", iban: "FR7630006000011234567890189" };

const facture = (o) => ({ type: "bill", documentDate: "2026-09-01", ...NOMINATIF, ...o });

const FACTURES = [
  facture({ id: 1001, code: "FA-1001", validated: 1, yardId: 77, quoteId: 451, toBePaid: 925.15, atiTotal: 1850.31, deductedAdvance: 925.16 }),
  facture({ id: 1002, code: "FA-1002", validated: 0, yardId: 77, quoteId: 451, toBePaid: 500 }),
  facture({ id: 1003, code: "FA-1003", validated: 1, yardId: 0, quoteId: 500, toBePaid: 100 }),
  facture({ id: 1004, code: "FA-1004", validated: 1, yardId: 12345, quoteId: 500, toBePaid: 50 }),
  facture({ id: 1005, code: "FA-1005", validated: 1, yardId: 77, quoteId: 500, toBePaid: 10 }),
  facture({ id: 1006, code: "FA-1006", validated: 1, yardId: 77, quoteId: 451, toBePaid: null }),
  facture({ id: 1007, code: "AV-1007", validated: 1, yardId: 90, quoteId: 0, toBePaid: -925.15 }),
];

const transaction = (o) => ({ date: "2026-09-05", paymentMode: "transfer", ...BANCAIRE, ...o });
const TRANSACTIONS = [
  transaction({ id: 5001, canceled: 0, checked: 1, checking: [{ docType: "bill", docId: 1001, amount: 925.15, thirdId: 4242 }] }),
  transaction({ id: 5002, canceled: 1, checked: 1, checking: [{ docType: "bill", docId: 1003, amount: 100 }] }),
  transaction({ id: 5003, canceled: 0, checked: 0, checking: [{ docType: "bill", docId: 1003, amount: 100 }] }),
  transaction({ id: 5004, canceled: 0, checked: 1, checking: [{ docType: "supplierBill", docId: 9, amount: 5 }] }),
  transaction({ id: 5005, canceled: 0, checked: 1, checking: [{ docType: "bill", docId: 999999, amount: 12 }] }),
  transaction({ id: 5006, canceled: 0, checked: 1, checking: [{ docType: "bill", docId: 1007, amount: -925.15 }] }),
];

const enElements = (bruts) => bruts.map((brut) => ({ id: brut.id, brut }));

/** La ligne telle qu'elle serait en base après une première synchronisation. */
function ligneEnBase(brut, chantierId, id, synchroniseLe = "2026-01-01T00:00:00.000Z") {
  const n = normaliserFactureProgbat(brut, { synchroniseLe });
  assert.equal(n.ok, true, "fixture : la facture doit être normalisable");
  const f = fusionnerFactureProgbat(null, { ...n.ligne, chantier_id: chantierId });
  return { ...f.ligne, id };
}

/**
 * Doublures. Le dépôt est un Proxy : toute propriété autre que les cinq
 * lectures attendues lève — une tentative d'écriture (insert, update, delete…)
 * ne peut donc pas passer inaperçue.
 */
function faireDepot({ factures = [], reglements = [], contexte = CONTEXTE } = {}) {
  const appels = [];
  const lectures = {
    chargerYards: async () => { appels.push("chantier_progbat_yards"); return contexte.yards; },
    chargerExports: async () => { appels.push("progbat_quote_exports"); return contexte.exports; },
    chargerLiaisons: async () => { appels.push("chantier_projets"); return contexte.liaisons; },
    chargerFactures: async () => { appels.push("chantier_factures_client"); return factures; },
    chargerReglements: async () => { appels.push("chantier_factures_reglements"); return reglements; },
  };
  const depot = new Proxy(lectures, {
    get(cible, prop) {
      if (prop in cible) return cible[prop];
      if (typeof prop === "symbol") return undefined;
      throw new Error(`ÉCRITURE OU ACCÈS INTERDIT sur le dépôt : ${String(prop)}`);
    },
  });
  return { depot, appels };
}

function faireProgbat({ bills = FACTURES, transactions = TRANSACTIONS, pageSize = PAGE_SIZE, erreurs = {} } = {}) {
  const appels = [];
  const source = { bills, transactions };
  return {
    appels,
    lirePage: async ({ ressource, limit, offset, tri }) => {
      appels.push({ ressource, limit, offset, tri });
      if (erreurs[ressource]) return erreurs[ressource];
      const lot = (source[ressource] || []).slice(offset, offset + Math.min(limit, pageSize));
      return { ok: true, data: lot };
    },
  };
}

const lancer = async (opts = {}) => {
  const { depot, appels } = faireDepot(opts);
  const progbat = faireProgbat(opts);
  // pageSize réduit : les fixtures tiennent en une page, l'arrêt sur page
  // courte est vérifié séparément.
  const r = await executerDryRun({ depot, progbat, maintenant: MAINTENANT, pageSize: 100, maxPages: MAX_PAGES });
  return { r, appelsDepot: appels, appelsProgbat: progbat.appels };
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. SÉCURITÉ DE LA FONCTION (analyse statique de index.ts)
// ═══════════════════════════════════════════════════════════════════════════
test("edge : appelant authentifié, actif et du bureau — même règle que progbat-test-connection", () => {
  assert.match(INDEX_CODE, /auth\.getUser\(jwt\)/);
  assert.match(INDEX_CODE, /Non authentifié/);
  assert.match(INDEX_CODE, /401\)/);
  assert.match(INDEX_CODE, /from\("utilisateurs"\)\s*\n?\s*\.select\("role,actif"\)/);
  assert.match(INDEX_CODE, /profil\.actif === false/);
  assert.match(INDEX_CODE, /profil\.role === "ouvrier"/);
  assert.match(INDEX_CODE, /Accès réservé aux utilisateurs du bureau\./);
  assert.match(INDEX_CODE, /403\)/);
  // La vérification précède TOUT appel ProGBat : le jeton n'est même pas lu
  // avant d'avoir refusé un ouvrier.
  assert.ok(
    INDEX_CODE.indexOf('profil.role === "ouvrier"') < INDEX_CODE.indexOf("choisirJeton("),
    "le refus ouvrier doit précéder le choix du jeton",
  );
  assert.ok(
    INDEX_CODE.indexOf('profil.role === "ouvrier"') < INDEX_CODE.indexOf("executerDryRun("),
    "le refus ouvrier doit précéder le diagnostic",
  );
});

test("edge : service_role côté serveur seulement, jamais renvoyé", () => {
  assert.match(INDEX_CODE, /SUPABASE_SERVICE_ROLE_KEY/);
  // La clé sert à construire le client, et n'apparaît dans aucune réponse ni
  // aucun journal.
  assert.doesNotMatch(INDEX_CODE, /json\([^)]*SERVICE_ROLE/);
  assert.doesNotMatch(INDEX_CODE, /console\.[a-z]+\([^)]*SERVICE_ROLE/);
});

test("edge : jeton de facturation prioritaire, repli seulement s'il est ABSENT", () => {
  // La règle elle-même (module pur).
  assert.deepEqual(choisirJeton({ billing: "B", legacy: "L" }), { token: "B", source: "billing" });
  assert.deepEqual(choisirJeton({ billing: "", legacy: "L" }), { token: "L", source: "legacy" });
  assert.deepEqual(choisirJeton({ billing: "   ", legacy: "L" }), { token: "L", source: "legacy" });
  assert.deepEqual(choisirJeton({ billing: "B", legacy: "" }), { token: "B", source: "billing" });
  assert.deepEqual(choisirJeton({}), { token: "", source: null });
  // Le branchement : les deux secrets, dans le bon rôle.
  assert.match(INDEX_CODE, /billing: Deno\.env\.get\("PROGBAT_BILLING_ACCESS_TOKEN"\)/);
  assert.match(INDEX_CODE, /legacy: Deno\.env\.get\("PROGBAT_PRIVATE_ACCESS_TOKEN"\)/);
  // Un seul choix de jeton : aucun second essai avec l'autre jeton.
  assert.equal((INDEX_CODE.match(/choisirJeton\(/g) || []).length, 1);
});

test("edge : le jeton n'est ni renvoyé ni journalisé", () => {
  for (const ligne of INDEX_CODE.split("\n")) {
    if (/console\.(log|warn|error)/.test(ligne) || /json\(\{/.test(ligne)) {
      assert.doesNotMatch(ligne, /\$\{token\}/, `jeton journalisé ou renvoyé : ${ligne.trim()}`);
      assert.doesNotMatch(ligne, /\bBearer\b/, `en-tête d'autorisation journalisé : ${ligne.trim()}`);
    }
  }
  // Seule la PROVENANCE du jeton ("billing" / "legacy") est tracée.
  assert.match(INDEX_CODE, /jeton=\$\{source\}/);
});

test("edge : ProGBat en GET uniquement, aucun PDF", () => {
  const verbes = INDEX_CODE.match(/method:\s*"[A-Z]+"/g) || [];
  assert.deepEqual([...new Set(verbes)], ['method: "GET"'], "un seul verbe sortant : GET");
  // `req.method !== "POST"` porte sur la requête ENTRANTE : c'est le seul
  // "POST" toléré, et il n'est pas un verbe sortant.
  assert.match(INDEX_CODE, /req\.method !== "POST"/);
  assert.doesNotMatch(INDEX_CODE, /\/pdf/);
  // Un seul appel réseau sortant, et ses options ne portent AUCUN corps.
  const appelsFetch = [...INDEX_CODE.matchAll(/fetch\(/g)];
  assert.equal(appelsFetch.length, 1, "un seul appel sortant");
  const debut = appelsFetch[0].index;
  const options = INDEX_CODE.slice(debut, INDEX_CODE.indexOf("\n    })", debut));
  assert.ok(!/\bbody\b/.test(options), "aucun corps envoyé à ProGBat");
  assert.match(options, /method: "GET"/);
  // Les deux seules ressources lues — nommées par le module pur, l'Edge
  // Function ne fait que composer l'URL de liste.
  assert.match(options, /\/company\/\$\{ressource\}\?limit=\$\{limit\}&offset=\$\{offset\}/);
  const MODULE = lire("src/Renovation/progbatBillingDryRun.mjs");
  assert.match(MODULE, /ressource: "bills"/);
  assert.match(MODULE, /ressource: "transactions"/);
  assert.equal((MODULE.match(/ressource: "/g) || []).length, 2, "aucune autre ressource ProGBat");
});

test("edge : aucune écriture Supabase, uniquement des SELECT", () => {
  for (const interdit of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
    assert.ok(!INDEX_CODE.includes(interdit), `${interdit} ne doit pas apparaître`);
  }
  assert.match(INDEX_CODE, /\.select\(/);
  // Les colonnes sont NOMMÉES : pas de select("*") qui ramènerait extraction,
  // document_path ou commentaire.
  assert.doesNotMatch(INDEX_CODE, /\.select\("\*"\)/);
});

test("edge : progbat_quote_exports lu sans hash, sans auteur, sans message d'erreur", () => {
  assert.match(INDEX_CODE, /"progbat_quote_exports", "project_id,progbat_quote_id"/);
  for (const interdit of ["payload_hash", "created_by", "created_by_email", "error_message", "http_status"]) {
    assert.ok(!INDEX_CODE.includes(interdit), `${interdit} ne doit pas être sélectionné`);
  }
});

test("edge : aucun cron, aucun déclenchement automatique", () => {
  assert.doesNotMatch(INDEX_CODE, /cron|schedule/i);
  // La fonction ne répond qu'à un POST authentifié.
  assert.match(INDEX_CODE, /req\.method !== "POST"/);
});

test("edge : la copie lib/ est à jour", async () => {
  const { verifierCopies, CIBLES } = await import(new URL("../scripts/sync-progbat-edge-lib.mjs", import.meta.url).href);
  assert.deepEqual(verifierCopies(), [], "node scripts/sync-progbat-edge-lib.mjs");
  assert.deepEqual(CIBLES["progbat-billing-dry-run"], [
    "progbatFacturation.mjs", "progbatLiaison.mjs", "progbatYards.mjs", "progbatBillingDryRun.mjs",
  ]);
});

test("edge : les règles ne sont pas réécrites dans index.ts", () => {
  // Tout ce qui décide vient des modules purs. index.ts ne fait que brancher
  // le réseau, la base et l'authentification : aucun champ du PAYLOAD ProGBat
  // (camelCase) n'y est lu. Les noms de COLONNES (progbat_validated…) sont, eux,
  // légitimes : ce sont les colonnes sélectionnées.
  for (const champ of ["yardId", "quoteId", "toBePaid", "docType", "situationNumber", "checking", "atiTotal"]) {
    assert.ok(!INDEX_CODE.includes(champ), `le champ ProGBat « ${champ} » doit rester dans les modules purs`);
  }
  for (const regle of [/(?<!progbat_)\bvalidated\b/, /(?<!progbat_)\bcanceled\b/, /(?<!progbat_)\bchecked\b/]) {
    assert.doesNotMatch(INDEX_CODE, regle, `la règle ${regle} doit rester dans les modules purs`);
  }
  assert.match(INDEX_CODE, /from "\.\/lib\/progbatBillingDryRun\.mjs"/);
  assert.match(INDEX_CODE, /from "\.\/lib\/progbatYards\.mjs"/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PAGINATION
// ═══════════════════════════════════════════════════════════════════════════
const pageur = (pages) => {
  const appels = [];
  return {
    appels,
    lirePage: async ({ limit, offset, tri }) => {
      appels.push({ limit, offset, tri });
      const p = pages[appels.length - 1];
      return p ?? { ok: true, data: [] };
    },
  };
};

test("pagination : plusieurs pages, offset croissant, limite demandée", async () => {
  const page = (debut, n) => ({ ok: true, data: Array.from({ length: n }, (_, i) => ({ id: debut + i })) });
  const p = pageur([page(1, 10), page(11, 10), page(21, 3)]);
  const r = await lireRessourceProgbat(p.lirePage, { tri: null, pageSize: 10, maxPages: 40 });
  assert.equal(r.ok, true);
  assert.equal(r.pages, 3);
  assert.equal(r.complet, true);
  assert.equal(r.garde_atteinte, false);
  assert.equal(r.nombre_recu, 23);
  assert.equal(r.elements.length, 23);
  assert.deepEqual(p.appels.map((a) => a.offset), [0, 10, 20]);
  assert.deepEqual([...new Set(p.appels.map((a) => a.limit))], [10]);
});

test("pagination : arrêt sur une page COURTE, jamais sur Content-Range", async () => {
  const p = pageur([
    { ok: true, data: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })) },
    { ok: true, data: [{ id: 11 }, { id: 12 }] },   // page courte → fin
    { ok: true, data: [{ id: 13 }] },               // ne doit jamais être lue
  ]);
  const r = await lireRessourceProgbat(p.lirePage, { tri: null, pageSize: 10, maxPages: 40 });
  assert.equal(p.appels.length, 2, "aucune page lue après la page courte");
  assert.equal(r.complet, true);
  assert.equal(r.elements.length, 12);
  // Aucune lecture d'en-tête : la doublure n'en fournit aucun et tout fonctionne.
  // Et le CODE (commentaires exclus) ne mentionne Content-Range nulle part.
  for (const rel of ["src/Renovation/progbatBillingDryRun.mjs", "src/Renovation/progbatYards.mjs"]) {
    // Commentaires de ligne ET blocs JSDoc écartés : seul le code compte.
    const code = lire(rel).split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    assert.ok(!/content-range/i.test(code), `${rel} : l'arrêt ne doit pas dépendre de Content-Range`);
  }
  assert.ok(!/content-range/i.test(INDEX_CODE), "index.ts : aucun en-tête de pagination lu");
});

test("pagination : page vide = fin immédiate", async () => {
  const p = pageur([{ ok: true, data: [] }]);
  const r = await lireRessourceProgbat(p.lirePage, { tri: null, pageSize: 10, maxPages: 40 });
  assert.equal(r.ok, true);
  assert.equal(r.pages, 1);
  assert.equal(r.complet, true);
  assert.equal(r.elements.length, 0);
});

test("pagination : déduplication par id ENTRE les pages, le comptage reçu reste juste", async () => {
  const p = pageur([
    { ok: true, data: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] },
    { ok: true, data: [{ id: 4 }, { id: 5 }, { id: 1 }] },   // page courte → fin
  ]);
  const r = await lireRessourceProgbat(p.lirePage, { tri: null, pageSize: 4, maxPages: 40 });
  assert.equal(r.nombre_recu, 7, "sept éléments reçus");
  assert.equal(r.elements.length, 5, "cinq identifiants distincts");
  assert.equal(r.doublons, 2);
  assert.deepEqual(r.elements.map((e) => e.id), [1, 2, 3, 4, 5]);
});

test("pagination : garde de 40 pages, et la liste n'est JAMAIS dite complète", async () => {
  let appels = 0;
  const pleine = async () => {
    appels++;
    return { ok: true, data: Array.from({ length: 100 }, (_, i) => ({ id: appels * 1000 + i })) };
  };
  const r = await lireRessourceProgbat(pleine, { tri: null, pageSize: 100, maxPages: MAX_PAGES });
  assert.equal(MAX_PAGES, 40);
  assert.equal(appels, 40, "la boucle s'arrête à 40 pages");
  assert.equal(r.pages, 40);
  assert.equal(r.complet, false);
  assert.equal(r.garde_atteinte, true);
});

test("pagination : garde atteinte sur les FACTURES → erreur explicite, aucun résultat", async () => {
  const bills = Array.from({ length: 400 }, (_, i) => facture({ id: i + 1, validated: 1, yardId: 77, toBePaid: 1 }));
  const { depot } = faireDepot({});
  const progbat = faireProgbat({ bills, pageSize: 10 });
  const r = await executerDryRun({ depot, progbat, maintenant: MAINTENANT, pageSize: 10, maxPages: 5 });
  assert.equal(r.ok, false);
  assert.match(r.erreur, /garde de 5 pages atteinte/);
  assert.match(r.erreur, /complet/);
  assert.equal(r.rapport, undefined, "aucun rapport n'est rendu");
});

test("pagination : une page en échec arrête tout, sans liste partielle « complète »", async () => {
  const p = pageur([
    { ok: true, data: Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })) },
    { ok: false, status: 429, message: "ProGBat limite les appels (429)." },
    { ok: true, data: [{ id: 99 }] },
  ]);
  const r = await lireRessourceProgbat(p.lirePage, { tri: null, pageSize: 10, maxPages: 40 });
  assert.equal(p.appels.length, 2, "aucune page après l'échec");
  assert.equal(r.ok, false);
  assert.equal(r.status, 429);
  assert.equal(r.complet, false);
  assert.equal(r.garde_atteinte, false);
});

test("pagination : échec des FACTURES → le diagnostic échoue avec le statut ProGBat", async () => {
  const { depot } = faireDepot({});
  const progbat = faireProgbat({ erreurs: { bills: { ok: false, status: 403, message: "Accès refusé par ProGBat (403)." } } });
  const r = await executerDryRun({ depot, progbat, maintenant: MAINTENANT });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.match(r.erreur, /403/);
});

test("tri : conservé, et repris SANS tri seulement sur 400/422", async () => {
  assert.equal(TRI_FACTURES, '{"documentDate":-1}');
  assert.equal(TRI_TRANSACTIONS, '{"date":-1}');

  // 400 : une seule reprise, sans tri, puis plus jamais de tri.
  const p = pageur([
    { ok: false, status: 400, message: "sort invalide" },
    { ok: true, data: [{ id: 1 }, { id: 2 }] },
  ]);
  const r = await lireRessourceProgbat(p.lirePage, { tri: TRI_FACTURES, pageSize: 10, maxPages: 40 });
  assert.equal(r.ok, true);
  assert.equal(r.tri_refuse, true);
  assert.equal(r.tri_applique, false);
  assert.deepEqual(p.appels.map((a) => a.tri), [TRI_FACTURES, null]);
  assert.equal(r.pages, 1, "la reprise ne compte pas pour une page de plus");

  // 422 : même traitement.
  const q = pageur([{ ok: false, status: 422, message: "unprocessable" }, { ok: true, data: [] }]);
  const r2 = await lireRessourceProgbat(q.lirePage, { tri: TRI_FACTURES, pageSize: 10, maxPages: 40 });
  assert.equal(r2.ok, true);
  assert.equal(r2.tri_refuse, true);

  // 401 / 403 / 429 / 500 : AUCUNE reprise — l'erreur est le diagnostic.
  for (const status of [401, 403, 429, 500]) {
    const z = pageur([{ ok: false, status, message: `HTTP ${status}` }, { ok: true, data: [] }]);
    const rz = await lireRessourceProgbat(z.lirePage, { tri: TRI_FACTURES, pageSize: 10, maxPages: 40 });
    assert.equal(z.appels.length, 1, `aucune reprise sur ${status}`);
    assert.equal(rz.ok, false);
    assert.equal(rz.status, status);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FACTURES
// ═══════════════════════════════════════════════════════════════════════════
test("factures : brouillons ignorés, jamais résolus ni comptés en création", async () => {
  const { r } = await lancer();
  assert.equal(r.ok, true);
  const f = r.rapport.factures;
  assert.equal(f.categories.brouillon_ignore, 1);
  assert.equal(f.exemples.brouillon_ignore[0].progbat_bill_id, 1002);
  assert.match(f.exemples.brouillon_ignore[0].motif, /non validée|brouillon/i);
  // Un brouillon ne consomme aucune issue de résolution.
  const totalResolution = Object.values(f.resolution).reduce((s, n) => s + n, 0);
  assert.equal(totalResolution, FACTURES.length - 2, "brouillon et facture illisible hors résolution");
});

test("factures : normalisation refusée (toBePaid absent) ≠ brouillon", async () => {
  const { r } = await lancer();
  const f = r.rapport.factures;
  assert.equal(f.categories.normalisation_refusee, 1);
  assert.equal(f.exemples.normalisation_refusee[0].progbat_bill_id, 1006);
  assert.match(f.exemples.normalisation_refusee[0].motif, /montant exigible|toBePaid/i);
});

test("factures : le yard est prioritaire sur le devis", async () => {
  const { r } = await lancer();
  const f = r.rapport.factures;
  // 1001 (yard 77 et devis 451 d'accord) et 1007 (yard 90, quoteId = 0).
  // 1005 porte le même yard 77 mais un devis contradictoire : il part en
  // conflit, pas en résolution par yard.
  assert.equal(f.resolution.resolution_yard, 2);
  const ex = f.exemples.creation.find((e) => e.progbat_bill_id === 1001);
  assert.equal(ex.chantier_id, "tilleuls");
  assert.equal(ex.resolution, "resolution_yard");
  // Le devis 451 mène au même chantier : la résolution est bien attribuée au
  // YARD, pas au repli.
  const avoir = f.exemples.creation.find((e) => e.progbat_bill_id === 1007);
  assert.equal(avoir.resolution, "resolution_yard");
  assert.equal(avoir.quote_id, null, "le yard décide même sans devis");
});

test("factures : repli par le devis SEULEMENT sans yardId exploitable", async () => {
  const { r } = await lancer();
  const f = r.rapport.factures;
  assert.equal(f.resolution.resolution_devis_secours, 1);
  const ex = f.exemples.creation.find((e) => e.progbat_bill_id === 1003);
  assert.equal(ex.chantier_id, "acacias");
  assert.equal(ex.resolution, "resolution_devis_secours");
  assert.equal(ex.yard_id, null, "yardId = 0 est un champ vide, pas un chantier");
});

test("factures : yard non rattaché → jamais de repli silencieux, rien n'est créé", async () => {
  const { r } = await lancer();
  const f = r.rapport.factures;
  assert.equal(f.resolution.yard_non_rattache, 1);
  const ex = f.exemples.non_resolue.find((e) => e.progbat_bill_id === 1004);
  assert.equal(ex.resolution, "yard_non_rattache");
  assert.equal(ex.chantier_id, null, "le chantier du devis n'est pas repris en silence");
  assert.match(ex.motif, /12345/);
  // La facture 1004 n'apparaît dans AUCUNE création.
  assert.ok(!f.exemples.creation.some((e) => e.progbat_bill_id === 1004));
});

test("factures : conflit yard / devis → aucun chantier choisi", async () => {
  const { r } = await lancer();
  const f = r.rapport.factures;
  assert.equal(f.resolution.conflit, 1);
  const ex = f.exemples.non_resolue.find((e) => e.progbat_bill_id === 1005);
  assert.equal(ex.resolution, "conflit");
  assert.equal(ex.chantier_id, null);
  assert.match(ex.motif, /Contradiction/i);
});

test("factures : registre vide → tout est création, aucune mise à jour", async () => {
  const { r } = await lancer();
  const f = r.rapport.factures;
  assert.equal(f.deja_en_base, 0);
  assert.equal(f.categories.creation, 3, "1001, 1003, 1007");
  assert.equal(f.categories.mise_a_jour, 0);
  assert.equal(f.categories.inchangee, 0);
  assert.equal(f.categories.non_resolue, 2, "1004 et 1005");
  assert.equal(f.recues, FACTURES.length);
  // Somme des catégories = factures reçues : rien ne se perd en route.
  assert.equal(Object.values(f.categories).reduce((s, n) => s + n, 0), FACTURES.length);
});

test("factures : une facture déjà synchronisée est INCHANGÉE — progbat_synced_at ignoré", async () => {
  const existante = ligneEnBase(FACTURES[0], "tilleuls", "f-1001");
  const { r } = await lancer({ factures: [existante] });
  const f = r.rapport.factures;
  assert.equal(f.categories.inchangee, 1);
  assert.equal(f.categories.mise_a_jour, 0);
  assert.equal(f.categories.creation, 2);
  // Le champ volatil est bien le seul écart entre la base et la proposition.
  assert.ok(CHAMPS_VOLATILS_FACTURE.includes("progbat_synced_at"));
  assert.ok(!CHAMPS_COMPARES_FACTURE.includes("progbat_synced_at"));
});

test("factures : un montant ou un numéro qui bouge → mise à jour, champs nommés", async () => {
  const existante = { ...ligneEnBase(FACTURES[0], "tilleuls", "f-1001"), montant_ttc: 900, numero: "FA-ANCIEN" };
  const { r } = await lancer({ factures: [existante] });
  const f = r.rapport.factures;
  assert.equal(f.categories.mise_a_jour, 1);
  assert.equal(f.categories.inchangee, 0);
  const ex = f.exemples.mise_a_jour[0];
  assert.equal(ex.progbat_bill_id, 1001);
  assert.match(ex.motif, /montant_ttc/);
  assert.match(ex.motif, /numero/);
});

test("factures : numeric rendu en chaîne par PostgREST ne crée pas de fausse mise à jour", async () => {
  const base = ligneEnBase(FACTURES[0], "tilleuls", "f-1001");
  const existante = {
    ...base,
    montant_ttc: "925.15",             // PostgREST rend un numeric en texte
    progbat_to_be_paid: "925.15",
    progbat_ati_total: "1850.31",
    progbat_deducted_advance: "925.16",
    progbat_validated: "1",
  };
  const { r } = await lancer({ factures: [existante] });
  assert.equal(r.rapport.factures.categories.inchangee, 1);
  assert.equal(r.rapport.factures.categories.mise_a_jour, 0);
  // Et la comparaison reste stricte sur un vrai écart.
  assert.equal(memeValeur("925.15", 925.15), true);
  assert.equal(memeValeur("925.15", 925.16), false);
  assert.equal(memeValeur(null, undefined), true);
  assert.equal(memeValeur(0, null), false);
  assert.equal(memeValeur("2026-09-01", "2026-09-02"), false);
});

test("factures : une ligne manuelle n'est jamais transformée (fusion refusée)", () => {
  // Cas défensif : la base l'interdit déjà (contrainte source/progbat_bill_id),
  // la règle est vérifiée quand même — c'est elle qui protège une saisie humaine.
  const manuelle = { id: "f-man", source: "manuel", progbat_bill_id: 1001, chantier_id: "tilleuls" };
  const a = analyserFactures({
    elements: enElements([FACTURES[0]]), contexte: CONTEXTE,
    existantes: [manuelle], synchroniseLe: MAINTENANT,
  });
  assert.equal(a.journal.categories.fusion_refusee, 1);
  assert.equal(a.journal.categories.creation, 0);
  assert.match(a.journal.exemples.fusion_refusee[0].motif, /saisie à la main/i);
});

test("factures : avoir négatif conservé signé, jamais en valeur absolue", async () => {
  const { r } = await lancer();
  const ex = r.rapport.factures.exemples.creation.find((e) => e.progbat_bill_id === 1007);
  assert.equal(ex.montant_ttc, -925.15);
  assert.equal(ex.chantier_id, "acacias");
  assert.equal(ex.type, "bill", "un avoir reste de type bill");
});

test("factures : valeurs distinctes de validated remontées telles quelles", async () => {
  const { r } = await lancer();
  const v = r.rapport.valeurs_distinctes.factures_validated;
  const par = Object.fromEntries(v.map((e) => [String(e.valeur), e.occurrences]));
  assert.equal(par["1"], 6);
  assert.equal(par["0"], 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. RÈGLEMENTS
// ═══════════════════════════════════════════════════════════════════════════
test("règlements : actif SEULEMENT si canceled = 0 ET checked = 1", () => {
  assert.equal(transactionActive({ canceled: 0, checked: 1 }).actif, true);
  assert.equal(transactionActive({ canceled: "0", checked: "1" }).actif, true);
  for (const couple of [
    { canceled: 1, checked: 1 }, { canceled: 0, checked: 0 }, { canceled: 1, checked: 0 },
    { canceled: 0 }, { checked: 1 }, {}, { canceled: null, checked: 1 },
    { canceled: false, checked: true }, { canceled: "oui", checked: 1 }, { canceled: 0.0001, checked: 1 },
  ]) {
    assert.equal(transactionActive(couple).actif, false, `couple ${JSON.stringify(couple)} doit être exclu`);
  }
  // Entier strict : rien d'approchant n'est accepté.
  assert.equal(entierStrict(0), 0);
  assert.equal(entierStrict("0"), 0);
  assert.equal(entierStrict(1.5), null);
  assert.equal(entierStrict(true), null);
  assert.equal(entierStrict(""), null);
});

test("règlements : les couples inconnus sont rapportés BRUTS, jamais interprétés", async () => {
  const { r } = await lancer();
  const g = r.rapport.reglements;
  assert.equal(g.categories.transaction_inactive_ou_inconnue, 2, "5002 (canceled=1) et 5003 (checked=0)");
  const inactives = g.exemples.transaction_inactive_ou_inconnue;
  const t5002 = inactives.find((e) => e.progbat_transaction_id === 5002);
  assert.equal(t5002.canceled, 1, "la valeur brute est rendue");
  assert.equal(t5002.checked, 1);
  assert.ok(!/annul/i.test(t5002.motif), "canceled = 1 n'est pas traduit par « annulé »");
  // Valeurs distinctes comptées, sur TOUTES les transactions.
  const canceled = Object.fromEntries(r.rapport.valeurs_distinctes.transactions_canceled.map((e) => [String(e.valeur), e.occurrences]));
  const checked = Object.fromEntries(r.rapport.valeurs_distinctes.transactions_checked.map((e) => [String(e.valeur), e.occurrences]));
  assert.equal(canceled["0"], 5);
  assert.equal(canceled["1"], 1);
  assert.equal(checked["1"], 5);
  assert.equal(checked["0"], 1);
  assert.equal(g.transactions_recues, TRANSACTIONS.length);
  assert.equal(g.transactions_actives, 4);
});

test("règlements : docType autre que « bill » ignoré, et compté à part", async () => {
  const { r } = await lancer();
  const g = r.rapport.reglements;
  assert.equal(g.categories.lettrage_ignore, 1);
  const ex = g.exemples.lettrage_ignore[0];
  assert.equal(ex.progbat_transaction_id, 5004);
  assert.equal(ex.progbat_bill_id, null, "un lettrage non-facture ne porte aucun bill.id");
  assert.match(ex.motif, /supplierBill/);
  const docTypes = Object.fromEntries(r.rapport.valeurs_distinctes.checking_doc_type.map((e) => [String(e.valeur), e.occurrences]));
  assert.equal(docTypes["bill"], 3, "les lettrages des transactions ACTIVES seulement");
  assert.equal(docTypes["supplierBill"], 1);
});

test("règlements : montant négatif (remboursement d'avoir) conservé signé", async () => {
  const { r } = await lancer();
  const ex = r.rapport.reglements.exemples.creation.find((e) => e.progbat_transaction_id === 5006);
  assert.equal(ex.montant, -925.15);
  assert.equal(ex.progbat_bill_id, 1007);
});

test("règlements : facture introuvable → catégorie dédiée, jamais rattachée au hasard", async () => {
  const { r } = await lancer();
  const g = r.rapport.reglements;
  assert.equal(g.categories.facture_introuvable, 1);
  const ex = g.exemples.facture_introuvable[0];
  assert.equal(ex.progbat_transaction_id, 5005);
  assert.equal(ex.progbat_bill_id, 999999);
  assert.equal(ex.facture_id, null);
});

test("règlements : un lettrage d'une facture NON RÉSOLUE reste introuvable", async () => {
  // La facture 1004 (yard non rattaché) n'est pas retenue : son règlement ne
  // doit surtout pas se rattacher à un chantier voisin.
  const tr = [transaction({ id: 5100, canceled: 0, checked: 1, checking: [{ docType: "bill", docId: 1004, amount: 50 }] })];
  const { r } = await lancer({ transactions: tr });
  assert.equal(r.rapport.reglements.categories.facture_introuvable, 1);
  assert.equal(r.rapport.reglements.categories.creation, 0);
});

test("règlements : création sur une facture existante, puis inchangé, puis mise à jour", async () => {
  const existanteF = ligneEnBase(FACTURES[0], "tilleuls", "f-1001");

  // a. la facture est en base, le règlement non → création
  const a = await lancer({ factures: [existanteF] });
  const creation = a.r.rapport.reglements.exemples.creation.find((e) => e.progbat_transaction_id === 5001);
  assert.equal(creation.facture_id, "f-1001");
  assert.match(creation.motif, /absent du registre/i);

  // b. le règlement est déjà en base à l'identique → inchangé
  const reglement = {
    id: "r-1", facture_id: "f-1001", source: "progbat",
    progbat_transaction_id: 5001, progbat_doc_type: "bill", progbat_canceled: 0,
    date_reglement: "2026-09-05", montant: "925.15", mode: "transfer", annule: false,
  };
  const b = await lancer({ factures: [existanteF], reglements: [reglement] });
  assert.equal(b.r.rapport.reglements.categories.inchange, 1);
  assert.equal(b.r.rapport.reglements.categories.mise_a_jour, 0);

  // c. un montant qui a bougé → mise à jour, champ nommé
  const c = await lancer({ factures: [existanteF], reglements: [{ ...reglement, montant: "900.00" }] });
  assert.equal(c.r.rapport.reglements.categories.mise_a_jour, 1);
  assert.match(c.r.rapport.reglements.exemples.mise_a_jour[0].motif, /montant/);
});

test("règlements : `annule` posé à la main n'est pas « remis à false » par le diagnostic", async () => {
  const existanteF = ligneEnBase(FACTURES[0], "tilleuls", "f-1001");
  const reglement = {
    id: "r-1", facture_id: "f-1001", source: "progbat",
    progbat_transaction_id: 5001, progbat_doc_type: "bill", progbat_canceled: 0,
    date_reglement: "2026-09-05", montant: "925.15", mode: "transfer",
    annule: true,   // décision humaine
  };
  const { r } = await lancer({ factures: [existanteF], reglements: [reglement] });
  assert.equal(r.rapport.reglements.categories.inchange, 1, "le drapeau `annule` ne déclenche pas de mise à jour");
  assert.equal(r.rapport.reglements.categories.mise_a_jour, 0);
});

test("règlements : absence locale → annulation PROPOSÉE seulement si la lecture est complète", async () => {
  const existanteF = ligneEnBase(FACTURES[0], "tilleuls", "f-1001");
  const orphelin = {
    id: "r-9", facture_id: "f-1001", source: "progbat",
    progbat_transaction_id: 7777, progbat_doc_type: "bill", progbat_canceled: 0,
    date_reglement: "2026-08-01", montant: "300.00", mode: "check", annule: false,
  };

  // a. lecture complète → l'absence est proposée à l'annulation (et rien d'autre)
  const a = await lancer({ factures: [existanteF], reglements: [orphelin] });
  assert.equal(a.r.rapport.reconciliation_absence_autorisee, true);
  assert.equal(a.r.rapport.reglements.categories.annulation_proposee, 1);
  const ex = a.r.rapport.reglements.exemples.annulation_proposee[0];
  assert.equal(ex.progbat_transaction_id, 7777);
  assert.equal(ex.facture_id, "f-1001");
  assert.match(ex.motif, /rien n'est modifié/i);

  // b. transactions en ERREUR → aucune annulation, et le drapeau le dit
  const { depot } = faireDepot({ factures: [existanteF], reglements: [orphelin] });
  const progbatKo = faireProgbat({ erreurs: { transactions: { ok: false, status: 429, message: "429" } } });
  const b = await executerDryRun({ depot, progbat: progbatKo, maintenant: MAINTENANT, pageSize: 100, maxPages: MAX_PAGES });
  assert.equal(b.ok, true, "les factures restent diagnosticables");
  assert.equal(b.rapport.reconciliation_absence_autorisee, false);
  assert.equal(b.rapport.reglements.categories.annulation_proposee, 0);
  assert.equal(b.rapport.pagination.transactions.ok, false);
  assert.equal(b.rapport.pagination.transactions.complet, false);
  assert.match(b.rapport.pagination.transactions.erreur, /429/);

  // c. garde atteinte sur les transactions → même prudence
  const nombreuses = Array.from({ length: 200 }, (_, i) => transaction({ id: 9000 + i, canceled: 0, checked: 1, checking: [] }));
  const { depot: d3 } = faireDepot({ factures: [existanteF], reglements: [orphelin] });
  const p3 = faireProgbat({ transactions: nombreuses, pageSize: 10 });
  const c = await executerDryRun({ depot: d3, progbat: p3, maintenant: MAINTENANT, pageSize: 10, maxPages: 3 });
  assert.equal(c.ok, true);
  assert.equal(c.rapport.pagination.transactions.garde_atteinte, true);
  assert.equal(c.rapport.pagination.transactions.complet, false);
  assert.equal(c.rapport.reconciliation_absence_autorisee, false);
  assert.equal(c.rapport.reglements.categories.annulation_proposee, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. RÉPONSE : bornée, sans données sensibles, sans écriture
// ═══════════════════════════════════════════════════════════════════════════
test("réponse : aucune écriture observée, ni Supabase ni ProGBat", async () => {
  const { r, appelsDepot, appelsProgbat } = await lancer();
  // Le dépôt est un Proxy : seules les cinq lectures existent, toute autre
  // propriété (insert, update, delete…) aurait levé.
  assert.deepEqual([...new Set(appelsDepot)].sort(), [
    "chantier_factures_client", "chantier_factures_reglements",
    "chantier_progbat_yards", "chantier_projets", "progbat_quote_exports",
  ]);
  assert.deepEqual([...new Set(appelsProgbat.map((a) => a.ressource))].sort(), ["bills", "transactions"]);
  assert.deepEqual(r.rapport.ecritures, { supabase: 0, progbat: 0 });
  assert.equal(r.rapport.dry_run, true);
});

test("réponse : au maximum 20 exemples par catégorie, comptages COMPLETS", async () => {
  assert.equal(MAX_EXEMPLES, 20);
  const bills = Array.from({ length: 25 }, (_, i) => facture({ id: 2000 + i, validated: 0, yardId: 77, toBePaid: 10 }));
  const creables = Array.from({ length: 23 }, (_, i) => facture({ id: 3000 + i, validated: 1, yardId: 77, quoteId: 451, toBePaid: 10 }));
  const tr = Array.from({ length: 24 }, (_, i) => transaction({ id: 8000 + i, canceled: 1, checked: 1, checking: [] }));
  const { depot } = faireDepot({});
  const progbat = faireProgbat({ bills: [...bills, ...creables], transactions: tr, pageSize: 100 });
  const r = await executerDryRun({ depot, progbat, maintenant: MAINTENANT, pageSize: 100, maxPages: MAX_PAGES });
  const f = r.rapport.factures;
  assert.equal(f.categories.brouillon_ignore, 25);
  assert.equal(f.exemples.brouillon_ignore.length, 20);
  assert.equal(f.categories.creation, 23);
  assert.equal(f.exemples.creation.length, 20);
  assert.equal(r.rapport.reglements.categories.transaction_inactive_ou_inconnue, 24);
  assert.equal(r.rapport.reglements.exemples.transaction_inactive_ou_inconnue.length, 20);
  for (const liste of [...Object.values(f.exemples), ...Object.values(r.rapport.reglements.exemples)]) {
    assert.ok(liste.length <= MAX_EXEMPLES);
  }
});

test("réponse : liste blanche stricte des exemples, aucun champ en plus", async () => {
  const { r } = await lancer({ factures: [ligneEnBase(FACTURES[0], "tilleuls", "f-1001")] });
  for (const [categorie, liste] of Object.entries(r.rapport.factures.exemples)) {
    for (const ex of liste) {
      assert.deepEqual(Object.keys(ex).sort(), [...CHAMPS_EXEMPLE_FACTURE].sort(), `facture / ${categorie}`);
    }
  }
  for (const [categorie, liste] of Object.entries(r.rapport.reglements.exemples)) {
    for (const ex of liste) {
      assert.deepEqual(Object.keys(ex).sort(), [...CHAMPS_EXEMPLE_REGLEMENT].sort(), `règlement / ${categorie}`);
    }
  }
});

test("réponse : aucune donnée nominative, bancaire ni payload brut", async () => {
  const { r } = await lancer({ factures: [ligneEnBase(FACTURES[0], "tilleuls", "f-1001")] });
  const texte = JSON.stringify(r.rapport);
  for (const valeur of [
    NOMINATIF.clientName, NOMINATIF.clientAddress, NOMINATIF.clientPostcode, NOMINATIF.clientCity,
    NOMINATIF.clientEmail, NOMINATIF.clientPhone, "Dépose cloison",
    BANCAIRE.label, BANCAIRE.paymentNumber, BANCAIRE.iban,
  ]) {
    assert.ok(!texte.includes(valeur), `la valeur « ${valeur} » ne doit pas sortir`);
  }
  for (const cle of [
    "clientName", "clientAddress", "clientEmail", "clientPhone", "content",
    "thirdId", "bankAccountId", "paymentNumber", "iban", "payload", "token",
  ]) {
    assert.ok(!texte.includes(`"${cle}"`), `la clé « ${cle} » ne doit pas sortir`);
  }
  // Et l'identifiant du tiers (4242) n'apparaît nulle part non plus.
  assert.ok(!texte.includes("4242"));
});

test("réponse : forme complète — pagination, valeurs distinctes, comptages, durée", async () => {
  const { r } = await lancer();
  const rap = r.rapport;
  assert.deepEqual(Object.keys(rap).sort(), [
    "dry_run", "duree_ms", "ecritures", "factures", "genere_le",
    "pagination", "reconciliation_absence_autorisee", "reglements", "valeurs_distinctes",
  ].sort());
  for (const ressource of ["bills", "transactions"]) {
    assert.deepEqual(Object.keys(rap.pagination[ressource]).sort(), [
      "complet", "doublons", "erreur", "garde_atteinte", "nombre_distinct",
      "nombre_recu", "ok", "pages", "tri_applique", "tri_refuse",
    ].sort());
    assert.equal(rap.pagination[ressource].ok, true);
    assert.equal(rap.pagination[ressource].complet, true);
  }
  assert.equal(rap.pagination.bills.nombre_recu, FACTURES.length);
  assert.equal(rap.pagination.transactions.nombre_recu, TRANSACTIONS.length);
  assert.deepEqual(Object.keys(rap.valeurs_distinctes).sort(), [
    "checking_doc_type", "factures_validated", "transactions_canceled", "transactions_checked",
  ].sort());
  assert.deepEqual(Object.keys(rap.factures.categories).sort(), [...CATEGORIES_FACTURE].sort());
  assert.deepEqual(Object.keys(rap.reglements.categories).sort(), [...CATEGORIES_REGLEMENT].sort());
  assert.equal(typeof rap.duree_ms, "number");
  assert.equal(rap.genere_le, MAINTENANT);
});

test("réponse : le diagnostic est déterministe (deux passages identiques)", async () => {
  const factures = [ligneEnBase(FACTURES[0], "tilleuls", "f-1001")];
  const a = await lancer({ factures });
  const b = await lancer({ factures });
  assert.deepEqual(a.r.rapport.factures, b.r.rapport.factures);
  assert.deepEqual(a.r.rapport.reglements, b.r.rapport.reglements);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. MODULES RÉUTILISÉS — aucune seconde version des règles
// ═══════════════════════════════════════════════════════════════════════════
test("module : les règles viennent de progbatFacturation et progbatLiaison", () => {
  const source = lire("src/Renovation/progbatBillingDryRun.mjs");
  assert.match(source, /from "\.\/progbatFacturation\.mjs"/);
  assert.match(source, /from "\.\/progbatLiaison\.mjs"/);
  assert.match(source, /from "\.\/progbatYards\.mjs"/);
  for (const attendu of [
    "normaliserFactureProgbat", "fusionnerFactureProgbat", "normaliserReglementProgbat",
    "resoudreChantierDepuisFacture", "parcourirListe",
  ]) {
    assert.ok(source.includes(attendu), `${attendu} doit être réutilisé`);
  }
  // Aucune re-déclaration locale des règles réutilisées.
  for (const interdit of [
    "function normaliserFactureProgbat", "function fusionnerFactureProgbat",
    "function normaliserReglementProgbat", "function resoudreChantierDepuisFacture",
    "function parcourirListe",
  ]) {
    assert.ok(!source.includes(interdit), `${interdit} ne doit pas être réécrit ici`);
  }
  // Les modules réutilisés ne sont pas modifiés : ils n'importent rien d'ici.
  assert.ok(!lire("src/Renovation/progbatFacturation.mjs").includes("progbatBillingDryRun"));
  assert.ok(!lire("src/Renovation/progbatLiaison.mjs").includes("progbatBillingDryRun"));
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
console.log(`\nverif-progbat-billing-dry-run : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
