#!/usr/bin/env node
// Vérifie la SYNCHRONISATION RÉELLE de la facturation ProGBat :
//   1. les règles pures de src/Renovation/progbatBillingSync.mjs, branchées sur
//      une base en MÉMOIRE et une API ProGBat doublée ;
//   2. l'Edge Function supabase/functions/progbat-billing-sync/index.ts, par
//      analyse statique — seul contrôle possible sans déployer, et il attrape
//      ce qui compte : confirmation exigée avant tout appel, authentification,
//      verbe sortant, jeton journalisé, écriture ProGBat.
//
// LA BASE DOUBLÉE IMITE POSTGRESQL LÀ OÙ ÇA COMPTE pour l'idempotence :
//   • numeric(_,2) arrondit et revient en CHAÎNE ("300.00") ;
//   • jsonb NE CONSERVE PAS l'ordre des clés — il est ici volontairement
//     inversé, ce qu'aucune comparaison naïve ne survit ;
//   • les index uniques (progbat_bill_id ; progbat_transaction_id + facture_id)
//     refusent les doublons.
// Sans cela, « la deuxième passe ne modifie rien » passerait à tort.
//
// Aucun appel réseau, aucune base réelle, aucune migration, aucun déploiement.
//   node scripts/verif-progbat-billing-sync.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const {
  CONFIRMATION_ATTENDUE, CHAMPS_ECRITS_FACTURE, CHAMPS_ECRITS_REGLEMENT,
  COMPTEURS_FACTURE, COMPTEURS_REGLEMENT,
  creerDepotSynchronisation, executerSynchronisation, projeterEcriture, verifierConfirmation,
} = await import(new URL("../src/Renovation/progbatBillingSync.mjs", import.meta.url).href);

const { MAX_PAGES, PAGE_SIZE, LECTURES, memeValeur, serialiserCanonique } =
  await import(new URL("../src/Renovation/progbatBillingDryRun.mjs", import.meta.url).href);

const INDEX_TS = lire("supabase/functions/progbat-billing-sync/index.ts");
const INDEX_CODE = INDEX_TS.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const MODULE_SRC = lire("src/Renovation/progbatBillingSync.mjs");

// ═══════════════════════════════════════════════════════════════════════════
// BASE EN MÉMOIRE — assez fidèle pour que l'idempotence veuille dire quelque chose
// ═══════════════════════════════════════════════════════════════════════════
const T_FACTURES = LECTURES.factures.table;
const T_REGLEMENTS = LECTURES.reglements.table;

// Colonnes numeric(_,2) : arrondies à 2 décimales et rendues en CHAÎNE.
const NUMERIQUES = new Set([
  "montant_ht", "montant_tva", "montant_ttc", "pct_du_marche", "montant",
  "progbat_deal_net_total", "progbat_deal_taxes", "progbat_deal_ati_total",
  "progbat_achievement", "progbat_previous_achievement", "progbat_net_total",
  "progbat_taxes", "progbat_ati_total", "progbat_holdback", "progbat_deducted_advance",
  "progbat_to_be_paid", "progbat_ati_deductions",
]);
const JSONB = new Set(["progbat_tax_details", "progbat_deductions"]);

// PostgreSQL range les clés d'un jsonb à sa façon (longueur puis octets) : on
// les inverse ici, pour qu'aucune comparaison dépendante de l'ordre ne passe.
const reordonnerJsonb = (v) => {
  if (Array.isArray(v)) return v.map(reordonnerJsonb);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort().reverse()) out[k] = reordonnerJsonb(v[k]);
    return out;
  }
  return v;
};

const versBase = (ligne) => {
  const out = {};
  for (const [k, v] of Object.entries(ligne)) {
    if (v === null || v === undefined) { out[k] = null; continue; }
    if (NUMERIQUES.has(k)) { out[k] = Number(v).toFixed(2); continue; }
    if (JSONB.has(k)) { out[k] = reordonnerJsonb(v); continue; }
    out[k] = v;
  }
  return out;
};

/**
 * @param pannes (op, table, ligne) → message d'erreur, ou null pour laisser passer.
 */
function faireBase({ yards = [], exports = [], liaisons = [], factures = [], reglements = [], pannes = null } = {}) {
  let seq = 0;
  const tables = {
    chantier_progbat_yards: [...yards],
    progbat_quote_exports: [...exports],
    chantier_projets: [...liaisons],
    [T_FACTURES]: factures.map((f) => versBase({ id: f.id ?? `f-${++seq}`, ...f })),
    [T_REGLEMENTS]: reglements.map((r) => versBase({ id: r.id ?? `r-${++seq}`, ...r })),
  };
  const journal = [];          // trace ordonnée de toutes les opérations
  const appliquer = (lignes, filtres) => lignes.filter((l) => filtres.every(([op, col, a, b]) => {
    if (op === "eq") return l[col] === a;
    if (op === "gte") return typeof l[col] === "number" && l[col] >= a;
    if (op === "not") return a === "is" && b === null ? l[col] !== null && l[col] !== undefined : true;
    throw new Error(`filtre inattendu : ${op}`);
  }));
  const projeter = (l, colonnes) => Object.fromEntries(
    String(colonnes).split(",").map((c) => [c.trim(), l[c.trim()] ?? null]),
  );

  const client = {
    from(table) {
      const trace = { table, colonnes: null, filtres: [], op: "select" };
      const q = {
        select(colonnes) { trace.colonnes = colonnes; return q; },
        eq(col, val) { trace.filtres.push(["eq", col, val]); return q; },
        gte(col, val) { trace.filtres.push(["gte", col, val]); return q; },
        not(col, op, val) { trace.filtres.push(["not", col, op, val]); return q; },
        insert(ligne) { trace.op = "insert"; trace.ligne = ligne; return q; },
        update(patch) { trace.op = "update"; trace.patch = patch; return q; },
        then(resoudre, rejeter) {
          journal.push({ op: trace.op, table, colonnes: trace.colonnes });
          let resultat;
          try { resultat = executerRequete(trace); }
          catch (e) { resultat = { data: null, error: { message: String(e?.message || e) } }; }
          return Promise.resolve(resultat).then(resoudre, rejeter);
        },
      };
      return q;
    },
  };

  const executerRequete = (trace) => {
    // Le crochet passe AVANT la lecture de la table : il peut donc refuser
    // l'opération, mais aussi faire disparaître la ligne visée juste avant
    // l'écriture — ce qui est exactement le cas qu'on veut reproduire.
    const panne = pannes ? pannes(trace.op, trace.table, trace.ligne ?? trace.patch) : null;
    if (panne) return { data: null, error: { message: panne } };
    const lignes = tables[trace.table] ?? [];

    // COMPORTEMENT RÉEL DE PostgREST, et c'est tout l'intérêt de cette
    // doublure : sans .select(), une écriture ne renvoie AUCUNE donnée ; avec
    // .select(), elle renvoie la liste — éventuellement VIDE — des lignes
    // réellement écrites. Un UPDATE qui ne touche rien n'est pas une erreur :
    // c'est une requête valide et sans effet, `error` reste null.
    const retour = (touchees) => (trace.colonnes === null
      ? { data: null, error: null }
      : { data: touchees.map((l) => projeter(l, trace.colonnes)), error: null });

    if (trace.op === "select") {
      return { data: appliquer(lignes, trace.filtres).map((l) => projeter(l, trace.colonnes)), error: null };
    }
    if (trace.op === "insert") {
      const ligne = versBase({ id: `${trace.table === T_FACTURES ? "f" : "r"}-${++seq}`, ...trace.ligne });
      // Index uniques réels de sql/202609_facturation_progbat.sql.
      if (trace.table === T_FACTURES && ligne.progbat_bill_id != null
          && lignes.some((l) => String(l.progbat_bill_id) === String(ligne.progbat_bill_id))) {
        return { data: null, error: { message: "duplicate key value violates unique constraint \"uq_factures_client_progbat_bill\"" } };
      }
      if (trace.table === T_REGLEMENTS && ligne.progbat_transaction_id != null
          && lignes.some((l) => String(l.progbat_transaction_id) === String(ligne.progbat_transaction_id)
                             && String(l.facture_id) === String(ligne.facture_id))) {
        return { data: null, error: { message: "duplicate key value violates unique constraint \"uq_factures_reglements_progbat\"" } };
      }
      lignes.push(ligne);
      return retour([ligne]);
    }
    if (trace.op === "update") {
      const cibles = appliquer(lignes, trace.filtres);
      for (const l of cibles) Object.assign(l, versBase(trace.patch));
      // Zéro cible → data: [] et error: null. AUCUNE erreur n'est fabriquée :
      // c'est à l'appelant de voir qu'il n'a rien écrit.
      return retour(cibles);
    }
    throw new Error(`opération inattendue : ${trace.op}`);
  };

  return { client, tables, journal };
}

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════════════
const P1 = "aaaaaaaa-0000-0000-0000-000000000001";
const P2 = "aaaaaaaa-0000-0000-0000-000000000002";
const CONTEXTE = {
  yards: [
    { progbat_yard_id: 77, chantier_id: "tilleuls" },
    { progbat_yard_id: 90, chantier_id: "acacias" },
  ],
  exports: [
    { project_id: P1, progbat_quote_id: 451, statut: "created" },
    { project_id: P2, progbat_quote_id: 500, statut: "created" },
  ],
  liaisons: [
    { projet_id: P1, chantier_id: "tilleuls" },
    { projet_id: P2, chantier_id: "acacias" },
  ],
};
const MAINTENANT = "2026-09-17T08:00:00.000Z";

const NOMINATIF = {
  clientName: "SCI DUPONT-MARTIN", clientAddress: "12 rue des Lilas",
  clientPostcode: "69100", clientCity: "Villeurbanne",
  clientEmail: "compta@sci-dupont.example", clientPhone: "0600000000",
  thirdId: 4242, content: [{ label: "Dépose cloison", quantity: 3, price: 120 }],
};
const BANCAIRE = { bankAccountId: 7, label: "VIR SEPA SCI DUPONT", paymentNumber: "CHQ-0099", iban: "FR7630006000011234567890189" };

const facture = (o) => ({ type: "bill", documentDate: "2026-09-01", ...NOMINATIF, ...o });
const transaction = (o) => ({ date: "2026-09-05", paymentMode: "transfer", ...BANCAIRE, ...o });

// 1001 création (tilleuls) · 1002 brouillon · 1003 repli devis (acacias)
// 1004 yard non rattaché · 1005 conflit · 1007 avoir négatif (acacias)
const FACTURES = [
  facture({ id: 1001, code: "FA-1001", validated: 1, yardId: 77, quoteId: 451,
    toBePaid: 925.15, atiTotal: 1850.31, deductedAdvance: 925.16, achievement: 33.3333,
    taxDetails: [{ level: "normal", rate: 20, base: 771.79, amount: 154.36 }],
    deductions: [{ label: "Retenue", amount: 10, afterTaxes: true, direction: "minus", taxRate: 20 }] }),
  facture({ id: 1002, code: "FA-1002", validated: 0, yardId: 77, quoteId: 451, toBePaid: 500 }),
  facture({ id: 1003, code: "FA-1003", validated: 1, yardId: 0, quoteId: 500, toBePaid: 100 }),
  facture({ id: 1004, code: "FA-1004", validated: 1, yardId: 12345, quoteId: 500, toBePaid: 50 }),
  facture({ id: 1005, code: "FA-1005", validated: 1, yardId: 77, quoteId: 500, toBePaid: 10 }),
  facture({ id: 1007, code: "AV-1007", validated: 1, yardId: 90, quoteId: 0, toBePaid: -925.15 }),
];

// 5001 règle partiellement 1001 · 5002 inactive · 5004 lettrage fournisseur
// 5006 remboursement négatif sur l'avoir 1007
const TRANSACTIONS = [
  transaction({ id: 5001, canceled: 0, checked: 1, checking: [{ docType: "bill", docId: 1001, amount: 400.15, thirdId: 4242 }] }),
  transaction({ id: 5002, canceled: 1, checked: 1, checking: [{ docType: "bill", docId: 1003, amount: 100 }] }),
  transaction({ id: 5004, canceled: 0, checked: 1, checking: [{ docType: "supplierBill", docId: 9, amount: 5 }] }),
  transaction({ id: 5006, canceled: 0, checked: 1, checking: [{ docType: "bill", docId: 1007, amount: -925.15 }] }),
];

function faireProgbat({ bills = FACTURES, transactions = TRANSACTIONS, pageSize = PAGE_SIZE, erreurs = {} } = {}) {
  const appels = [];
  const source = { bills, transactions };
  return {
    appels,
    lirePage: async ({ ressource, limit, offset, tri }) => {
      appels.push({ ressource, limit, offset, tri });
      if (erreurs[ressource]) return erreurs[ressource];
      return { ok: true, data: (source[ressource] || []).slice(offset, offset + Math.min(limit, pageSize)) };
    },
  };
}

/** Une exécution complète sur une base donnée. Renvoie tout ce qu'on peut observer. */
async function synchroniser(base, options = {}) {
  const progbat = faireProgbat(options);
  const r = await executerSynchronisation({
    depot: creerDepotSynchronisation(base.client),
    progbat,
    maintenant: options.maintenant ?? MAINTENANT,
    pageSize: options.pageSize ?? 100,
    maxPages: options.maxPages ?? MAX_PAGES,
  });
  return { r, base, progbat };
}

const baseNeuve = (extra = {}) => faireBase({ ...CONTEXTE, ...extra });

// ═══════════════════════════════════════════════════════════════════════════
// 1. SÉCURITÉ — confirmation, appelant, verbes
// ═══════════════════════════════════════════════════════════════════════════
test("confirmation : exacte, et rien d'autre", () => {
  assert.equal(CONFIRMATION_ATTENDUE, "SYNCHRONISER_PROGBAT");
  assert.deepEqual(verifierConfirmation({ confirmation: "SYNCHRONISER_PROGBAT" }), { ok: true });
  for (const corps of [
    null, undefined, {}, { confirmation: "" }, { confirmation: "synchroniser_progbat" },
    { confirmation: " SYNCHRONISER_PROGBAT " }, { confirmation: true }, { confirmation: 1 },
    { confirmation: "SYNCHRONISER" }, { confirme: "SYNCHRONISER_PROGBAT" },
  ]) {
    const r = verifierConfirmation(corps);
    assert.equal(r.ok, false, `corps ${JSON.stringify(corps)} doit être refusé`);
    assert.match(r.erreur, /confirmation/i);
  }
});

test("edge : la confirmation est vérifiée AVANT le jeton, l'API et toute écriture", () => {
  assert.match(INDEX_CODE, /verifierConfirmation\(corps\)/);
  assert.match(INDEX_CODE, /400\)/);
  const iConfirm = INDEX_CODE.indexOf("verifierConfirmation(");
  assert.ok(iConfirm > 0);
  assert.ok(iConfirm < INDEX_CODE.indexOf("choisirJeton("), "la confirmation précède le choix du jeton");
  assert.ok(iConfirm < INDEX_CODE.indexOf("executerSynchronisation("), "la confirmation précède la synchronisation");
  assert.ok(iConfirm < INDEX_CODE.indexOf("creerDepotSynchronisation("), "la confirmation précède le dépôt d'écriture");
  // Le refus sort immédiatement : il n'y a pas de chemin qui continue après.
  assert.match(INDEX_CODE, /if \(!confirmation\.ok\) \{[\s\S]{0,260}?return json\(\{ ok: false, error: confirmation\.erreur \}, 400\)/);
});

test("edge : appelant authentifié, actif et du bureau — ouvrier refusé", () => {
  assert.match(INDEX_CODE, /auth\.getUser\(jwt\)/);
  assert.match(INDEX_CODE, /Non authentifié/);
  assert.match(INDEX_CODE, /profil\.actif === false/);
  assert.match(INDEX_CODE, /profil\.role === "ouvrier"/);
  assert.match(INDEX_CODE, /Accès réservé aux utilisateurs du bureau\./);
  // L'authentification précède tout, confirmation comprise.
  assert.ok(INDEX_CODE.indexOf('profil.role === "ouvrier"') < INDEX_CODE.indexOf("verifierConfirmation("));
  assert.ok(INDEX_CODE.indexOf('profil.role === "ouvrier"') < INDEX_CODE.indexOf("choisirJeton("));
  assert.match(INDEX_CODE, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("edge : ProGBat en GET seulement, aucune écriture distante, aucun PDF", () => {
  const verbes = [...new Set(INDEX_CODE.match(/method:\s*"[A-Z]+"/g) || [])];
  assert.deepEqual(verbes, ['method: "GET"']);
  const fetchs = [...INDEX_CODE.matchAll(/fetch\(/g)];
  assert.equal(fetchs.length, 1, "un seul appel sortant");
  const options = INDEX_CODE.slice(fetchs[0].index, INDEX_CODE.indexOf("\n    })", fetchs[0].index));
  assert.ok(!/\bbody\b/.test(options), "aucun corps envoyé à ProGBat");
  assert.doesNotMatch(INDEX_CODE, /\/pdf/);
});

test("edge : jeton prioritaire, jamais journalisé ; aucun cron", () => {
  assert.match(INDEX_CODE, /billing: Deno\.env\.get\("PROGBAT_BILLING_ACCESS_TOKEN"\)/);
  assert.match(INDEX_CODE, /legacy: Deno\.env\.get\("PROGBAT_PRIVATE_ACCESS_TOKEN"\)/);
  assert.equal((INDEX_CODE.match(/choisirJeton\(/g) || []).length, 1);
  for (const ligne of INDEX_CODE.split("\n")) {
    if (/console\.(log|warn|error)/.test(ligne) || /json\(\{/.test(ligne)) {
      assert.doesNotMatch(ligne, /\$\{token\}/, `jeton journalisé : ${ligne.trim()}`);
    }
  }
  assert.doesNotMatch(INDEX_CODE, /cron|schedule/i);
});

test("module : les écritures sont bornées à deux tables, sans DELETE", () => {
  const CODE = MODULE_SRC.split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*")).join("\n");
  assert.ok(!CODE.includes(".delete("), "aucune suppression : une annulation est un drapeau");
  assert.ok(!CODE.includes(".rpc("));
  // Les seules tables écrites sont celles du registre.
  const tables = [...CODE.matchAll(/client\.from\((t[FR])\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ["tF", "tR"]);
  assert.match(CODE, /const tF = LECTURES\.factures\.table/);
  assert.match(CODE, /const tR = LECTURES\.reglements\.table/);
  // Les règles ne sont pas réécrites : elles viennent du moteur du diagnostic.
  assert.match(CODE, /from "\.\/progbatBillingDryRun\.mjs"/);
  for (const interdit of ["function normaliserFactureProgbat", "function analyserReglements", "function resoudreChantierDepuisFacture"]) {
    assert.ok(!CODE.includes(interdit), `${interdit} ne doit pas être réécrit`);
  }
  // Les champs écrits sont une liste blanche dérivée des champs comparés.
  assert.ok(CHAMPS_ECRITS_FACTURE.includes("progbat_synced_at"));
  assert.ok(CHAMPS_ECRITS_REGLEMENT.includes("annule"));
  for (const jamais of ["commentaire", "extraction", "document_path", "ligne_id_modifie_par", "ligne_id_modifie_le", "montant_encaisse"]) {
    assert.ok(!CHAMPS_ECRITS_FACTURE.includes(jamais), `${jamais} ne doit jamais être écrit`);
  }
  assert.equal(projeterEcriture({ a: 1, b: undefined }, ["a", "b", "c"]).b, undefined);
  assert.deepEqual(Object.keys(projeterEcriture({ a: 1, b: undefined }, ["a", "b", "c"])), ["a"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ABANDON AVANT ÉCRITURE
// ═══════════════════════════════════════════════════════════════════════════
test("factures illisibles → abandon global, zéro écriture", async () => {
  for (const erreur of [
    { ok: false, status: 403, message: "Accès refusé par ProGBat (403)." },
    { ok: false, status: 429, message: "429" },
    { ok: false, status: 0, message: "réseau" },
  ]) {
    const base = baseNeuve();
    const { r } = await synchroniser(base, { erreurs: { bills: erreur } });
    assert.equal(r.ok, false);
    assert.equal(r.rapport, undefined, "aucun rapport : rien n'a été tenté");
    assert.equal(r.status, erreur.status);
    assert.equal(base.tables[T_FACTURES].length, 0);
    assert.equal(base.journal.filter((j) => j.op !== "select").length, 0, "aucune écriture");
  }
});

test("garde de pages sur les factures → abandon global, zéro écriture", async () => {
  const bills = Array.from({ length: 200 }, (_, i) => facture({ id: 9000 + i, validated: 1, yardId: 77, toBePaid: 1 }));
  const base = baseNeuve();
  const { r } = await synchroniser(base, { bills, pageSize: 10, maxPages: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.rapport, undefined);
  assert.match(r.erreur, /garde de 3 pages atteinte/);
  assert.equal(base.journal.filter((j) => j.op !== "select").length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. PREMIÈRE PASSE
// ═══════════════════════════════════════════════════════════════════════════
test("première passe : crée les factures résolues, ignore le reste", async () => {
  const base = baseNeuve();
  const { r } = await synchroniser(base);
  assert.equal(r.ok, true);
  assert.equal(r.rapport.partiel, false);
  assert.equal(r.rapport.dry_run, false);

  const f = r.rapport.factures.categories;
  assert.equal(f.creation, 3, "1001, 1003 et 1007");
  assert.equal(f.mise_a_jour, 0);
  assert.equal(f.inchangee, 0);
  assert.equal(f.echec, 0);
  // Brouillon 1002 + non résolues 1004 (yard) et 1005 (conflit).
  assert.equal(f.ignoree, 3);
  assert.equal(Object.keys(f).sort().join(","), [...COMPTEURS_FACTURE].sort().join(","));

  const enBase = base.tables[T_FACTURES];
  assert.equal(enBase.length, 3);
  assert.deepEqual(enBase.map((l) => l.progbat_bill_id).sort((a, b) => a - b), [1001, 1003, 1007]);
  for (const bill of [1002, 1004, 1005]) {
    assert.ok(!enBase.some((l) => l.progbat_bill_id === bill), `la facture ${bill} ne doit pas être écrite`);
  }
});

test("première passe : les règles de montants validées sont respectées", async () => {
  const base = baseNeuve();
  await synchroniser(base);
  const f1001 = base.tables[T_FACTURES].find((l) => l.progbat_bill_id === 1001);
  assert.equal(f1001.source, "progbat");
  assert.equal(f1001.progbat_validated, 1);
  assert.equal(f1001.montant_ttc, "925.15");
  assert.equal(f1001.progbat_to_be_paid, "925.15", "montant_ttc = progbat_to_be_paid");
  assert.equal(f1001.montant_ht, null);
  assert.equal(f1001.montant_tva, null);
  assert.equal(f1001.chantier_id, "tilleuls");
  assert.equal(f1001.statut, "emise");
  assert.equal(f1001.progbat_synced_at, MAINTENANT);
  // L'avoir garde son signe : jamais de valeur absolue.
  const avoir = base.tables[T_FACTURES].find((l) => l.progbat_bill_id === 1007);
  assert.equal(avoir.montant_ttc, "-925.15");
  assert.equal(avoir.chantier_id, "acacias");
});

test("première passe : les règlements suivent, avec les VRAIS uuid", async () => {
  const base = baseNeuve();
  const { r } = await synchroniser(base);
  const g = r.rapport.reglements.categories;
  assert.equal(g.creation, 2, "5001 sur 1001, 5006 sur l'avoir 1007");
  assert.equal(g.mise_a_jour, 0);
  assert.equal(g.inchange, 0);
  assert.equal(g.annulation, 0);
  assert.equal(g.echec, 0);
  assert.equal(Object.keys(g).sort().join(","), [...COMPTEURS_REGLEMENT].sort().join(","));

  const lignes = base.tables[T_REGLEMENTS];
  assert.equal(lignes.length, 2);
  const f1001 = base.tables[T_FACTURES].find((l) => l.progbat_bill_id === 1001);
  const r5001 = lignes.find((l) => l.progbat_transaction_id === 5001);
  assert.equal(r5001.facture_id, f1001.id, "le facture_id est l'uuid réel, pas le bill.id");
  assert.notEqual(r5001.facture_id, 1001);
  // Paiement partiel : 400,15 encaissés sur 925,15 dus, montant signé conservé.
  assert.equal(r5001.montant, "400.15");
  assert.equal(r5001.source, "progbat");
  assert.equal(r5001.progbat_doc_type, "bill");
  assert.equal(r5001.annule, false);
  // Remboursement d'avoir : négatif, conservé tel quel.
  const r5006 = lignes.find((l) => l.progbat_transaction_id === 5006);
  assert.equal(r5006.montant, "-925.15");
  assert.equal(r5006.facture_id, base.tables[T_FACTURES].find((l) => l.progbat_bill_id === 1007).id);
});

test("ordre : toutes les factures écrites, puis relecture des uuid, puis les règlements", async () => {
  const base = baseNeuve();
  await synchroniser(base);
  const ecrituresF = base.journal.map((j, i) => ({ ...j, i })).filter((j) => j.op === "insert" && j.table === T_FACTURES);
  const ecrituresR = base.journal.map((j, i) => ({ ...j, i })).filter((j) => j.op !== "select" && j.table === T_REGLEMENTS);
  const relectures = base.journal.map((j, i) => ({ ...j, i })).filter((j) => j.op === "select" && j.table === T_FACTURES);
  assert.ok(ecrituresF.length > 0 && ecrituresR.length > 0);
  const derniereFacture = Math.max(...ecrituresF.map((j) => j.i));
  const premierReglement = Math.min(...ecrituresR.map((j) => j.i));
  assert.ok(derniereFacture < premierReglement, "aucun règlement avant la dernière facture");
  // Une relecture des factures s'intercale : c'est elle qui donne les uuid.
  assert.ok(relectures.some((j) => j.i > derniereFacture && j.i < premierReglement),
    "les identifiants réels sont relus entre les deux phases");
  assert.match(MODULE_SRC, /chargerIdsFactures/);
});

test("lettrages : seul docType « bill » entre, les transactions inactives sont ignorées", async () => {
  const base = baseNeuve();
  const { r } = await synchroniser(base);
  // 5002 inactive (canceled=1) + 5004 lettrage fournisseur → aucune ligne.
  assert.ok(!base.tables[T_REGLEMENTS].some((l) => [5002, 5004].includes(l.progbat_transaction_id)));
  assert.ok(r.rapport.reglements.categories.ignore >= 2);
  assert.equal(r.rapport.reglements.transactions_actives, 3, "5001, 5004, 5006");
  assert.equal(r.rapport.reglements.lettrages_retenus, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. IDEMPOTENCE
// ═══════════════════════════════════════════════════════════════════════════
test("deuxième passe : zéro création, zéro mise à jour, zéro écriture", async () => {
  const base = baseNeuve();
  await synchroniser(base);
  const apres1 = JSON.stringify(base.tables);
  const ecritures1 = base.journal.filter((j) => j.op !== "select").length;
  assert.ok(ecritures1 > 0);

  // Deuxième exécution, plus tard : seul progbat_synced_at aurait changé.
  const { r } = await synchroniser(base, { maintenant: "2026-09-18T09:30:00.000Z" });
  assert.equal(r.ok, true);
  assert.equal(r.rapport.partiel, false);
  assert.equal(r.rapport.ecritures.supabase, 0, "aucune écriture à la deuxième passe");
  assert.equal(r.rapport.factures.categories.creation, 0);
  assert.equal(r.rapport.factures.categories.mise_a_jour, 0);
  assert.equal(r.rapport.factures.categories.inchangee, 3);
  assert.equal(r.rapport.reglements.categories.creation, 0);
  assert.equal(r.rapport.reglements.categories.mise_a_jour, 0);
  assert.equal(r.rapport.reglements.categories.inchange, 2);
  assert.equal(JSON.stringify(base.tables), apres1, "la base est identique, à l'octet près");
  assert.equal(base.journal.filter((j) => j.op !== "select").length, ecritures1, "aucune opération d'écriture de plus");
});

test("idempotence : le jsonb réordonné et l'arrondi numeric ne créent pas de fausse mise à jour", async () => {
  // Les deux pièges que la base doublée reproduit exprès.
  const base = baseNeuve();
  await synchroniser(base);
  const f1001 = base.tables[T_FACTURES].find((l) => l.progbat_bill_id === 1001);
  assert.deepEqual(Object.keys(f1001.progbat_tax_details[0]), ["rate", "level", "base", "amount"],
    "la base a bien réordonné les clés du jsonb");
  assert.equal(f1001.progbat_achievement, "33.33", "la base a bien arrondi le numeric(_,2)");

  const { r } = await synchroniser(base);
  assert.equal(r.rapport.factures.categories.mise_a_jour, 0);
  assert.equal(r.rapport.factures.categories.inchangee, 3);
  // Les deux outils qui rendent cela possible.
  assert.equal(serialiserCanonique({ b: 1, a: 2 }), serialiserCanonique({ a: 2, b: 1 }));
  assert.notEqual(serialiserCanonique([1, 2]), serialiserCanonique([2, 1]), "l'ordre d'un tableau reste significatif");
  assert.equal(memeValeur(33.3333, "33.33"), true, "écart d'arrondi de colonne");
  assert.equal(memeValeur(12.345, "12.35"), true, "demi-centime exact : encore un arrondi");
  assert.equal(memeValeur(925.15, "925.16"), false, "un centime plein reste une différence");
});

test("mise à jour : la facture change chez ProGBat → un seul UPDATE", async () => {
  const base = baseNeuve();
  await synchroniser(base);
  const bills = FACTURES.map((f) => (f.id === 1001 ? { ...f, toBePaid: 1000.55, code: "FA-1001-B" } : f));
  const { r } = await synchroniser(base, { bills });
  assert.equal(r.rapport.factures.categories.mise_a_jour, 1);
  assert.equal(r.rapport.factures.categories.inchangee, 2);
  assert.equal(r.rapport.factures.categories.creation, 0);
  assert.equal(r.rapport.ecritures.supabase, 1);
  const f1001 = base.tables[T_FACTURES].find((l) => l.progbat_bill_id === 1001);
  assert.equal(f1001.montant_ttc, "1000.55");
  assert.equal(f1001.numero, "FA-1001-B");
});

test("mise à jour : le travail humain survit — échéance verrouillée, trace, commentaire", async () => {
  const base = baseNeuve();
  await synchroniser(base);
  // Un humain corrige l'échéance et commente. Le commentaire n'est même pas
  // une colonne lue par la synchronisation.
  const f1001 = base.tables[T_FACTURES].find((l) => l.progbat_bill_id === 1001);
  Object.assign(f1001, {
    ligne_id: "ech-3", ligne_nom: "Situation n° 3", ligne_id_verrouille: true,
    rapprochement: "corrige", raison: "Échéance corrigée à la main.",
    ligne_id_modifie_par: "user-1", ligne_id_modifie_le: "2026-09-17T10:00:00.000Z",
    commentaire: "à revoir avec le client", chantier_id: "tilleuls",
  });

  const bills = FACTURES.map((f) => (f.id === 1001 ? { ...f, toBePaid: 1000.55 } : f));
  const { r } = await synchroniser(base, { bills });
  assert.equal(r.rapport.factures.categories.mise_a_jour, 1);

  const apres = base.tables[T_FACTURES].find((l) => l.progbat_bill_id === 1001);
  assert.equal(apres.montant_ttc, "1000.55", "le montant ProGBat est bien repris");
  assert.equal(apres.ligne_id, "ech-3", "l'échéance verrouillée n'est pas reprise");
  assert.equal(apres.ligne_nom, "Situation n° 3");
  assert.equal(apres.ligne_id_verrouille, true);
  assert.equal(apres.rapprochement, "corrige");
  assert.equal(apres.raison, "Échéance corrigée à la main.");
  assert.equal(apres.ligne_id_modifie_par, "user-1", "la trace de la correction survit");
  assert.equal(apres.ligne_id_modifie_le, "2026-09-17T10:00:00.000Z");
  assert.equal(apres.commentaire, "à revoir avec le client", "le commentaire n'est jamais touché");
});

test("une facture manuelle n'est ni lue, ni transformée, ni écrasée", async () => {
  // DEUX protections, l'une derrière l'autre. chargerFactures ne retient que
  // source='progbat' : une ligne saisie à la main n'entre même pas dans
  // l'analyse — fusionnerFactureProgbat n'a donc jamais l'occasion de la voir.
  // Et si elle portait malgré tout le bill.id (ce que la contrainte de la
  // migration interdit), c'est l'index unique qui refuse la création.
  const base = baseNeuve({
    factures: [{
      id: "f-man", source: "manuel", progbat_bill_id: 1001, chantier_id: "tilleuls",
      numero: "saisie main", montant_ttc: 500, montant_ht: 416.67, commentaire: "facture papier",
    }],
  });
  const { r } = await synchroniser(base);
  assert.equal(r.ok, false, "l'échec est dit, pas masqué");
  assert.equal(r.rapport.factures.categories.echec, 1);
  assert.match(r.rapport.erreurs[0].message, /unique/i);
  assert.equal(r.rapport.factures.categories.creation, 2, "1003 et 1007 passent quand même");

  const manuelle = base.tables[T_FACTURES].find((l) => l.id === "f-man");
  assert.equal(manuelle.source, "manuel", "la source n'est pas retournée");
  assert.equal(manuelle.numero, "saisie main");
  assert.equal(manuelle.montant_ttc, "500.00", "le montant saisi est intact");
  assert.equal(manuelle.montant_ht, "416.67", "le HT saisi à la main survit");
  assert.equal(manuelle.commentaire, "facture papier");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. RÈGLEMENTS : réactivation et annulation
// ═══════════════════════════════════════════════════════════════════════════
test("réactivation : une transaction redevenue active rallume la ligne éteinte", async () => {
  const base = baseNeuve();
  await synchroniser(base);
  // La ligne a été éteinte lors d'un passage où la transaction avait disparu.
  const r5001 = base.tables[T_REGLEMENTS].find((l) => l.progbat_transaction_id === 5001);
  r5001.annule = true;

  const { r } = await synchroniser(base);
  assert.equal(r.rapport.reglements.categories.mise_a_jour, 1);
  assert.equal(r.rapport.reglements.categories.inchange, 1);
  assert.equal(base.tables[T_REGLEMENTS].find((l) => l.progbat_transaction_id === 5001).annule, false);
});

test("annulation : seulement sur une lecture complète des transactions", async () => {
  const base = baseNeuve();
  await synchroniser(base);
  const avant = base.tables[T_REGLEMENTS].map((l) => l.annule);
  assert.deepEqual(avant, [false, false]);

  // a. La transaction 5001 disparaît de ProGBat, lecture COMPLÈTE → annulation.
  const sans5001 = TRANSACTIONS.filter((t) => t.id !== 5001);
  const a = await synchroniser(base, { transactions: sans5001 });
  assert.equal(a.r.rapport.reconciliation_absence_autorisee, true);
  assert.equal(a.r.rapport.reglements.categories.annulation, 1);
  assert.equal(a.r.rapport.reglements.categories.deja_annule, 0);
  assert.equal(base.tables[T_REGLEMENTS].find((l) => l.progbat_transaction_id === 5001).annule, true);

  // b. Elle reste absente : déjà annulée, plus aucune écriture. Convergence.
  const ecrituresAvant = base.journal.filter((j) => j.op !== "select").length;
  const b = await synchroniser(base, { transactions: sans5001 });
  assert.equal(b.r.rapport.reglements.categories.deja_annule, 1);
  assert.equal(b.r.rapport.reglements.categories.annulation, 0);
  assert.equal(b.r.rapport.ecritures.supabase, 0);
  assert.equal(base.journal.filter((j) => j.op !== "select").length, ecrituresAvant);
});

test("annulation : jamais avec une pagination de transactions incomplète", async () => {
  for (const options of [
    { transactions: [], erreurs: { transactions: { ok: false, status: 500, message: "500" } } },
    { transactions: Array.from({ length: 200 }, (_, i) => transaction({ id: 20000 + i, canceled: 0, checked: 1, checking: [] })), pageSize: 10, maxPages: 3 },
  ]) {
    const base = baseNeuve();
    await synchroniser(base);                       // crée factures + 2 règlements
    const ecrituresAvant = base.journal.filter((j) => j.op !== "select").length;

    const { r } = await synchroniser(base, options);
    assert.equal(r.rapport.reconciliation_absence_autorisee, false);
    assert.equal(r.rapport.reglements.categories.annulation, 0, "aucune annulation sur lecture partielle");
    assert.equal(r.rapport.reglements.categories.deja_annule, 0);
    assert.deepEqual(base.tables[T_REGLEMENTS].map((l) => l.annule), [false, false],
      "les règlements restent vivants");
    assert.equal(base.journal.filter((j) => j.op !== "select").length, ecrituresAvant,
      "aucune écriture déclenchée par une absence non fiable");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. PANNE ET REPRISE
// ═══════════════════════════════════════════════════════════════════════════
test("panne au milieu : rapport partiel honnête, puis reprise idempotente", async () => {
  // La création de la facture 1003 est refusée par la base ; les autres passent.
  let refuser = true;
  const base = faireBase({
    ...CONTEXTE,
    pannes: (op, table, ligne) =>
      (refuser && op === "insert" && table === T_FACTURES && ligne?.progbat_bill_id === 1003)
        ? "colonne chantier_id : valeur refusée" : null,
  });

  const { r } = await synchroniser(base);
  assert.equal(r.ok, false, "jamais ok:true quand une écriture a échoué");
  assert.equal(r.rapport.partiel, true, "d'autres écritures ont abouti");
  assert.equal(r.rapport.factures.categories.creation, 2, "1001 et 1007 sont passées");
  assert.equal(r.rapport.factures.categories.echec, 1);
  assert.equal(r.rapport.erreurs_total, 1);
  assert.equal(r.rapport.erreurs.length, 1);
  assert.equal(r.rapport.erreurs[0].portee, "facture");
  assert.equal(r.rapport.erreurs[0].reference, 1003);
  assert.match(r.rapport.erreurs[0].message, /chantier_id/);
  assert.equal(r.rapport.ecritures.supabase, 4, "2 factures + 2 règlements");
  // La facture ratée n'a reçu aucun règlement : ses lettrages sont introuvables.
  assert.ok(!base.tables[T_FACTURES].some((l) => l.progbat_bill_id === 1003));

  // Reprise : la panne est levée, la passe suivante complète sans doublon.
  refuser = false;
  const reprise = await synchroniser(base);
  assert.equal(reprise.r.ok, true);
  assert.equal(reprise.r.rapport.partiel, false);
  assert.equal(reprise.r.rapport.factures.categories.creation, 1, "seule 1003 manquait");
  assert.equal(reprise.r.rapport.factures.categories.inchangee, 2);
  assert.equal(reprise.r.rapport.factures.categories.mise_a_jour, 0);
  assert.equal(base.tables[T_FACTURES].length, 3, "aucun doublon");
  assert.deepEqual(base.tables[T_FACTURES].map((l) => l.progbat_bill_id).sort((a, b) => a - b), [1001, 1003, 1007]);

  // Troisième passe : plus rien à faire.
  const stable = await synchroniser(base);
  assert.equal(stable.r.rapport.ecritures.supabase, 0);
});

test("écriture concurrente : l'index unique refuse le doublon, la passe suivante converge", async () => {
  // Deux exécutions se chevauchent : la nôtre a lu une base vide, l'autre crée
  // la facture 1001 juste avant notre insertion. Le crochet simule exactement
  // cet instant-là.
  let hook = null;
  const base = faireBase({ ...CONTEXTE, pannes: (...a) => (hook ? hook(...a) : null) });
  let injecte = false;
  hook = (op, table, ligne) => {
    if (!injecte && op === "insert" && table === T_FACTURES && ligne?.progbat_bill_id === 1001) {
      injecte = true;
      base.tables[T_FACTURES].push(versBase({
        id: "f-concurrent", source: "progbat", progbat_bill_id: 1001, chantier_id: "tilleuls",
        progbat_validated: 1, progbat_to_be_paid: 925.15, montant_ttc: 925.15,
      }));
    }
    return null;   // l'insertion part quand même : c'est la base qui tranche
  };

  const { r } = await synchroniser(base);
  assert.equal(r.ok, false, "le refus de la base n'est pas avalé");
  assert.equal(r.rapport.factures.categories.echec, 1);
  assert.equal(r.rapport.erreurs[0].reference, 1001);
  assert.match(r.rapport.erreurs[0].message, /unique/i);
  assert.equal(base.tables[T_FACTURES].filter((l) => l.progbat_bill_id === 1001).length, 1, "aucun doublon créé");

  // La passe suivante voit la ligne de l'autre exécution : elle ne crée plus
  // rien, elle la COMPLÈTE (la ligne injectée ne porte que quelques colonnes).
  const reprise = await synchroniser(base);
  assert.equal(reprise.r.ok, true);
  assert.equal(reprise.r.rapport.factures.categories.creation, 0, "plus aucune création");
  assert.equal(reprise.r.rapport.factures.categories.mise_a_jour, 1, "la ligne concurrente est complétée");
  assert.equal(reprise.r.rapport.factures.categories.inchangee, 2);
  assert.equal(base.tables[T_FACTURES].filter((l) => l.progbat_bill_id === 1001).length, 1, "toujours aucun doublon");

  // Et la convergence est atteinte : la passe d'après n'écrit plus rien.
  const stable = await synchroniser(base);
  assert.equal(stable.r.ok, true);
  assert.equal(stable.r.rapport.ecritures.supabase, 0);
  assert.equal(stable.r.rapport.factures.categories.inchangee, 3);
});

// ── Écritures sans effet : PostgREST ne les signale PAS comme des erreurs ───
// Un UPDATE dont le filtre ne trouve rien répond error: null. Ne regarder que
// `error` ferait compter une mise à jour ou une annulation réussie alors que
// zéro ligne a été écrite. Les trois cas ci-dessous provoquent exactement cela
// en faisant disparaître la ligne juste avant son écriture.
test("écriture sans effet : facture disparue entre la préparation et l'UPDATE", async () => {
  let hook = null;
  const base = faireBase({ ...CONTEXTE, pannes: (...a) => (hook ? hook(...a) : null) });
  await synchroniser(base);
  assert.equal(base.tables[T_FACTURES].length, 3);

  // 1003 change chez ProGBat → mise à jour prévue. Mais la ligne disparaît
  // (suppression concurrente) juste avant l'UPDATE.
  hook = (op, table, patch) => {
    if (op === "update" && table === T_FACTURES && patch?.progbat_bill_id === 1003) {
      base.tables[T_FACTURES] = base.tables[T_FACTURES].filter((l) => l.progbat_bill_id !== 1003);
    }
    return null;   // PostgREST ne renverra AUCUNE erreur : juste zéro ligne
  };
  const bills = FACTURES.map((f) => (f.id === 1003 ? { ...f, toBePaid: 222.22 } : f));
  const { r } = await synchroniser(base, { bills });

  assert.equal(r.ok, false, "une écriture sans effet ne peut pas donner ok:true");
  assert.equal(r.rapport.factures.categories.mise_a_jour, 0, "rien n'a été écrit, rien n'est compté");
  assert.equal(r.rapport.factures.categories.echec, 1);
  assert.equal(r.rapport.ecritures.supabase, 0, "ecritures.supabase n'est pas incrémenté");
  assert.equal(r.rapport.erreurs.length, 1);
  assert.equal(r.rapport.erreurs[0].portee, "facture");
  assert.equal(r.rapport.erreurs[0].reference, 1003);
  assert.match(r.rapport.erreurs[0].message, /aucune ligne touchée/i);

  // Reprise : la facture manquante est recréée, et la convergence revient.
  hook = null;
  const reprise = await synchroniser(base, { bills });
  assert.equal(reprise.r.ok, true);
  assert.equal(reprise.r.rapport.factures.categories.creation, 1, "1003 est recréée");
  assert.equal(reprise.r.rapport.factures.categories.echec, 0);
  const stable = await synchroniser(base, { bills });
  assert.equal(stable.r.rapport.ecritures.supabase, 0);
});

test("écriture sans effet : règlement disparu avant sa mise à jour", async () => {
  let hook = null;
  const base = faireBase({ ...CONTEXTE, pannes: (...a) => (hook ? hook(...a) : null) });
  await synchroniser(base);
  // La ligne a été éteinte : la transaction étant active, une mise à jour est
  // prévue pour la rallumer.
  base.tables[T_REGLEMENTS].find((l) => l.progbat_transaction_id === 5001).annule = true;

  // Le patch d'une mise à jour porte plusieurs colonnes ; celui d'une
  // annulation n'en porte qu'une (annule).
  hook = (op, table, patch) => {
    if (op === "update" && table === T_REGLEMENTS && Object.keys(patch || {}).length > 1) {
      base.tables[T_REGLEMENTS] = base.tables[T_REGLEMENTS].filter((l) => l.progbat_transaction_id !== 5001);
    }
    return null;
  };
  const { r } = await synchroniser(base);

  assert.equal(r.ok, false);
  assert.equal(r.rapport.reglements.categories.mise_a_jour, 0);
  assert.equal(r.rapport.reglements.categories.echec, 1);
  assert.equal(r.rapport.ecritures.supabase, 0);
  assert.equal(r.rapport.erreurs[0].portee, "reglement");
  assert.equal(r.rapport.erreurs[0].reference, 5001);
  assert.match(r.rapport.erreurs[0].message, /aucune ligne touchée/i);

  // Reprise : le règlement manquant est recréé.
  hook = null;
  const reprise = await synchroniser(base);
  assert.equal(reprise.r.ok, true);
  assert.equal(reprise.r.rapport.reglements.categories.creation, 1);
});

test("écriture sans effet : règlement disparu avant son annulation", async () => {
  let hook = null;
  const base = faireBase({ ...CONTEXTE, pannes: (...a) => (hook ? hook(...a) : null) });
  await synchroniser(base);

  // La transaction 5001 disparaît de ProGBat → annulation par absence prévue.
  hook = (op, table, patch) => {
    if (op === "update" && table === T_REGLEMENTS && Object.keys(patch || {}).length === 1 && patch.annule === true) {
      base.tables[T_REGLEMENTS] = base.tables[T_REGLEMENTS].filter((l) => l.progbat_transaction_id !== 5001);
    }
    return null;
  };
  const { r } = await synchroniser(base, { transactions: TRANSACTIONS.filter((t) => t.id !== 5001) });

  assert.equal(r.ok, false);
  assert.equal(r.rapport.reconciliation_absence_autorisee, true);
  assert.equal(r.rapport.reglements.categories.annulation, 0, "aucune annulation n'a réellement eu lieu");
  assert.equal(r.rapport.reglements.categories.echec, 1);
  assert.equal(r.rapport.ecritures.supabase, 0);
  assert.equal(r.rapport.erreurs[0].portee, "annulation");
  assert.equal(r.rapport.erreurs[0].reference, 5001);
  assert.match(r.rapport.erreurs[0].message, /aucune ligne touchée/i);
});

test("toute écriture demande le retour de sa ligne, et n'accepte qu'elle", async () => {
  const base = baseNeuve();
  await synchroniser(base);
  const ecritures = base.journal.filter((j) => j.op === "insert" || j.op === "update");
  assert.ok(ecritures.length > 0);
  for (const e of ecritures) {
    assert.equal(e.colonnes, "id", `${e.op} sur ${e.table} doit demander .select("id")`);
  }
  // Sans retour demandé, la doublure renvoie data: null — comme PostgREST — et
  // l'écriture doit alors être refusée plutôt que comptée pour acquise.
  const depot = creerDepotSynchronisation(base.client);
  const sansRetour = await (async () => {
    const q = base.client.from(T_FACTURES).update({ numero: "x" }).eq("id", "inexistant");
    const { data, error } = await q;
    return { data, error };
  })();
  assert.equal(sansRetour.error, null, "PostgREST ne signale AUCUNE erreur ici");
  assert.equal(sansRetour.data, null);
  // Et avec .select("id") sur une cible absente : liste vide, toujours sans erreur.
  const vide = await base.client.from(T_FACTURES).update({ numero: "x" }).eq("id", "inexistant").select("id");
  assert.equal(vide.error, null);
  assert.deepEqual(vide.data, []);
  // C'est ce cas-là que le dépôt transforme en échec explicite.
  const r = await depot.majFacture("inexistant", { numero: "x" });
  assert.equal(r.ok, false);
  assert.match(r.erreur, /aucune ligne touchée/i);
  const rr = await depot.majReglement("inexistant", { montant: 1 });
  assert.equal(rr.ok, false);
  const ra = await depot.annulerReglement("inexistant");
  assert.equal(ra.ok, false);
  assert.match(ra.erreur, /aucune ligne touchée/i);
});

test("relecture des identifiants impossible : la phase des règlements est abandonnée, pas devinée", async () => {
  const base = faireBase({
    ...CONTEXTE,
    pannes: (op, table, _l) => (op === "select" && table === T_FACTURES ? null : null),
  });
  // On casse la relecture APRÈS les créations, en remplaçant le client.
  const depot = creerDepotSynchronisation(base.client);
  const casse = { ...depot, chargerIdsFactures: async () => { throw new Error("timeout de lecture"); } };
  const r = await executerSynchronisation({
    depot: casse, progbat: faireProgbat({}), maintenant: MAINTENANT, pageSize: 100, maxPages: MAX_PAGES,
  });
  assert.equal(r.ok, false);
  assert.equal(r.rapport.partiel, true);
  assert.equal(r.rapport.reglements.traites, false);
  assert.equal(r.rapport.factures.categories.creation, 3, "les factures, elles, sont écrites");
  assert.equal(base.tables[T_REGLEMENTS].length, 0, "aucun règlement rattaché au hasard");
  assert.match(r.rapport.erreurs[0].message, /abandonn/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. RÉPONSE
// ═══════════════════════════════════════════════════════════════════════════
test("réponse : forme complète et bornée", async () => {
  const base = baseNeuve();
  const { r } = await synchroniser(base);
  const rap = r.rapport;
  assert.deepEqual(Object.keys(rap).sort(), [
    "dry_run", "duree_ms", "echecs", "ecritures", "erreurs", "erreurs_total",
    "factures", "genere_le", "ok", "pagination", "partiel",
    "reconciliation_absence_autorisee", "reglements",
  ].sort());
  assert.equal(rap.dry_run, false);
  assert.equal(rap.genere_le, MAINTENANT);
  assert.equal(typeof rap.duree_ms, "number");
  assert.equal(rap.ecritures.progbat, 0, "aucune écriture ProGBat, jamais");
  assert.equal(rap.ecritures.supabase, 5, "3 factures + 2 règlements");
  for (const ressource of ["bills", "transactions"]) {
    assert.equal(rap.pagination[ressource].ok, true);
    assert.equal(rap.pagination[ressource].complet, true);
  }
  assert.equal(rap.reconciliation_absence_autorisee, true);
  assert.deepEqual(rap.erreurs, []);
});

test("réponse : au plus 20 erreurs, comptage complet au-delà", async () => {
  const bills = Array.from({ length: 25 }, (_, i) => facture({ id: 4000 + i, validated: 1, yardId: 77, quoteId: 451, toBePaid: 10 }));
  const base = faireBase({ ...CONTEXTE, pannes: (op) => (op === "insert" ? "écriture refusée" : null) });
  const { r } = await synchroniser(base, { bills, transactions: [] });
  assert.equal(r.ok, false);
  assert.equal(r.rapport.partiel, false, "aucune écriture n'a abouti : raté, pas partiel");
  assert.equal(r.rapport.factures.categories.echec, 25);
  assert.equal(r.rapport.erreurs_total, 25);
  assert.equal(r.rapport.erreurs.length, 20, "exemples bornés");
  assert.equal(r.rapport.ecritures.supabase, 0);
});

test("réponse : aucune donnée nominative, bancaire ni payload brut", async () => {
  const base = baseNeuve();
  const { r } = await synchroniser(base);
  const texte = JSON.stringify(r.rapport);
  for (const valeur of [
    NOMINATIF.clientName, NOMINATIF.clientAddress, NOMINATIF.clientPostcode, NOMINATIF.clientCity,
    NOMINATIF.clientEmail, NOMINATIF.clientPhone, "Dépose cloison",
    BANCAIRE.label, BANCAIRE.paymentNumber, BANCAIRE.iban, "4242",
  ]) {
    assert.ok(!texte.includes(valeur), `« ${valeur} » ne doit pas sortir`);
  }
  for (const cle of ["clientName", "clientAddress", "clientEmail", "content", "thirdId", "bankAccountId", "paymentNumber", "iban", "payload", "token"]) {
    assert.ok(!texte.includes(`"${cle}"`), `la clé « ${cle} » ne doit pas sortir`);
  }
  // Et rien de bancaire n'entre non plus en base.
  const enBase = JSON.stringify(base.tables[T_REGLEMENTS]);
  for (const valeur of [BANCAIRE.label, BANCAIRE.paymentNumber, BANCAIRE.iban, String(BANCAIRE.bankAccountId)]) {
    assert.ok(!enBase.includes(valeur), `« ${valeur} » ne doit pas être stocké`);
  }
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
console.log(`\nverif-progbat-billing-sync : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
