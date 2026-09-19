#!/usr/bin/env node
// Vérifie le DÉCLENCHEMENT HORAIRE de la synchronisation ProGBat :
//   1. la porte du cron (src/Renovation/progbatBillingCron.mjs), exécutée pour
//      de vrai, avec une base en mémoire et une API ProGBat doublées ;
//   2. l'Edge Function supabase/functions/progbat-billing-sync-cron/index.ts et
//      supabase/config.toml, par analyse statique ;
//   3. que la fonction MANUELLE reste protégée exactement comme avant.
//
// Le point le plus important : prouver que les REFUS PRÉCÈDENT TOUT. Le module
// reçoit `ouvrirContexte` — une fonction qui, dans la vraie fonction, construit
// le client Supabase et lit le jeton ProGBat. Le harnais compte ses appels :
// tant qu'elle n'est pas appelée, rien n'a été lu, rien n'a été écrit, rien
// n'est parti vers ProGBat.
//
// Aucun réseau, aucune base réelle, aucun déploiement, aucun cron créé.
//   node scripts/verif-progbat-billing-sync-cron.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const {
  DECLENCHEUR, EN_TETE_SECRET, VARIABLE_SECRET,
  comparerSecretConstant, traiterAppelCron, verifierAppelCron,
} = await import(new URL("../src/Renovation/progbatBillingCron.mjs", import.meta.url).href);

const { LECTURES } = await import(new URL("../src/Renovation/progbatBillingDryRun.mjs", import.meta.url).href);
const { creerDepotSynchronisation } = await import(new URL("../src/Renovation/progbatBillingSync.mjs", import.meta.url).href);

const INDEX_CRON = lire("supabase/functions/progbat-billing-sync-cron/index.ts");
const INDEX_MANUEL = lire("supabase/functions/progbat-billing-sync/index.ts");
const CONFIG = lire("supabase/config.toml");
const sansCommentaires = (src, marque) => src.split("\n").filter((l) => !l.trimStart().startsWith(marque)).join("\n");
const CRON_CODE = sansCommentaires(INDEX_CRON, "//");
const MANUEL_CODE = sansCommentaires(INDEX_MANUEL, "//");
const CONFIG_CODE = sansCommentaires(CONFIG, "#");

const SECRET = "s3cr3t-cron-progbat-d0nt-l0g-me";

// ═══════════════════════════════════════════════════════════════════════════
// BASE EN MÉMOIRE + API ProGBat doublées (mêmes coercions que le harnais sync)
// ═══════════════════════════════════════════════════════════════════════════
const T_FACTURES = LECTURES.factures.table;
const T_REGLEMENTS = LECTURES.reglements.table;
const NUMERIQUES = new Set([
  "montant_ht", "montant_tva", "montant_ttc", "pct_du_marche", "montant",
  "progbat_deal_net_total", "progbat_deal_taxes", "progbat_deal_ati_total",
  "progbat_achievement", "progbat_previous_achievement", "progbat_net_total",
  "progbat_taxes", "progbat_ati_total", "progbat_holdback", "progbat_deducted_advance",
  "progbat_to_be_paid", "progbat_ati_deductions",
]);
const JSONB = new Set(["progbat_tax_details", "progbat_deductions"]);
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

function faireBase({ yards = [], exports = [], liaisons = [], pannes = null } = {}) {
  let seq = 0;
  const tables = {
    chantier_progbat_yards: [...yards],
    progbat_quote_exports: [...exports],
    chantier_projets: [...liaisons],
    [T_FACTURES]: [],
    [T_REGLEMENTS]: [],
  };
  const journal = [];
  const appliquer = (lignes, filtres) => lignes.filter((l) => filtres.every(([op, col, a, b]) => {
    if (op === "eq") return l[col] === a;
    if (op === "gte") return typeof l[col] === "number" && l[col] >= a;
    if (op === "not") return a === "is" && b === null ? l[col] !== null && l[col] !== undefined : true;
    throw new Error(`filtre inattendu : ${op}`);
  }));
  const projeter = (l, colonnes) => Object.fromEntries(
    String(colonnes).split(",").map((c) => [c.trim(), l[c.trim()] ?? null]),
  );
  const executerRequete = (trace) => {
    const panne = pannes ? pannes(trace.op, trace.table, trace.ligne ?? trace.patch) : null;
    if (panne) return { data: null, error: { message: panne } };
    const lignes = tables[trace.table] ?? [];
    const retour = (t) => (trace.colonnes === null
      ? { data: null, error: null }
      : { data: t.map((l) => projeter(l, trace.colonnes)), error: null });
    if (trace.op === "select") {
      return { data: appliquer(lignes, trace.filtres).map((l) => projeter(l, trace.colonnes)), error: null };
    }
    if (trace.op === "insert") {
      const ligne = versBase({ id: `${trace.table === T_FACTURES ? "f" : "r"}-${++seq}`, ...trace.ligne });
      if (trace.table === T_FACTURES && ligne.progbat_bill_id != null
          && lignes.some((l) => String(l.progbat_bill_id) === String(ligne.progbat_bill_id))) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint "uq_factures_client_progbat_bill"' } };
      }
      if (trace.table === T_REGLEMENTS && ligne.progbat_transaction_id != null
          && lignes.some((l) => String(l.progbat_transaction_id) === String(ligne.progbat_transaction_id)
                             && String(l.facture_id) === String(ligne.facture_id))) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint "uq_factures_reglements_progbat"' } };
      }
      lignes.push(ligne);
      return retour([ligne]);
    }
    if (trace.op === "update") {
      const cibles = appliquer(lignes, trace.filtres);
      for (const l of cibles) Object.assign(l, versBase(trace.patch));
      return retour(cibles);
    }
    throw new Error(`opération inattendue : ${trace.op}`);
  };
  const client = {
    from(table) {
      const trace = { table, colonnes: null, filtres: [], op: "select" };
      const q = {
        select(c) { trace.colonnes = c; return q; },
        eq(c, v) { trace.filtres.push(["eq", c, v]); return q; },
        gte(c, v) { trace.filtres.push(["gte", c, v]); return q; },
        not(c, o, v) { trace.filtres.push(["not", c, o, v]); return q; },
        insert(l) { trace.op = "insert"; trace.ligne = l; return q; },
        update(p) { trace.op = "update"; trace.patch = p; return q; },
        then(res, rej) {
          journal.push({ op: trace.op, table });
          let r;
          try { r = executerRequete(trace); } catch (e) { r = { data: null, error: { message: String(e?.message || e) } }; }
          return Promise.resolve(r).then(res, rej);
        },
      };
      return q;
    },
  };
  return { client, tables, journal };
}

const CONTEXTE = {
  yards: [{ progbat_yard_id: 77, chantier_id: "tilleuls" }],
  exports: [], liaisons: [],
};
const facture = (o) => ({ type: "bill", documentDate: "2026-09-01", clientName: "SCI DUPONT", ...o });
const transaction = (o) => ({ date: "2026-09-05", paymentMode: "transfer", label: "VIR SEPA", ...o });
const FACTURES = [
  facture({ id: 1001, code: "FA-1001", validated: 1, yardId: 77, toBePaid: 925.15 }),
  facture({ id: 1002, code: "FA-1002", validated: 1, yardId: 77, toBePaid: 500 }),
];
const TRANSACTIONS = [
  transaction({ id: 5001, canceled: 0, checked: 1, checking: [{ docType: "bill", docId: 1001, amount: 925.15 }] }),
];

/** Doublure ProGBat qui COMPTE ses appels : zéro appel doit rester zéro. */
function faireProgbat({ bills = FACTURES, transactions = TRANSACTIONS, pageSize = 100, erreurs = {} } = {}) {
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

/**
 * Lance la porte du cron avec un contexte INSTRUMENTÉ : on compte les
 * ouvertures de contexte, les lectures du jeton ProGBat, les appels ProGBat et
 * les opérations en base.
 */
async function lancer({
  methode = "POST", enTeteSecret = SECRET, secretServeur = SECRET,
  base = null, progbat = null, pageSize = 100, maxPages = 40, options = {},
} = {}) {
  const b = base ?? faireBase(CONTEXTE);
  const p = progbat ?? faireProgbat(options);
  const trace = { contexte: 0, jeton: 0 };
  const r = await traiterAppelCron({
    methode, enTeteSecret, secretServeur,
    ouvrirContexte: async () => {
      trace.contexte++;
      trace.jeton++;                        // c'est ici, et nulle part avant, qu'on lit le jeton
      return { ok: true, source: "billing", depot: creerDepotSynchronisation(b.client), progbat: p };
    },
    maintenant: "2026-09-17T08:00:00.000Z",
    debutMs: 0, finMs: 1200, pageSize, maxPages,
  });
  return { r, base: b, progbat: p, trace };
}

const ecritures = (base) => base.journal.filter((j) => j.op !== "select").length;

// ═══════════════════════════════════════════════════════════════════════════
// 1. LA PORTE — les refus, et la preuve qu'ils précèdent tout
// ═══════════════════════════════════════════════════════════════════════════
test("1. GET → 405, aucun appel, aucune écriture", async () => {
  const { r, base, progbat, trace } = await lancer({ methode: "GET" });
  assert.equal(r.status, 405);
  assert.equal(r.corps.ok, false);
  assert.equal(r.corps.error, "Method not allowed");
  assert.equal(trace.contexte, 0, "le contexte n'est jamais ouvert");
  assert.equal(progbat.appels.length, 0, "aucun appel ProGBat");
  assert.equal(base.journal.length, 0, "aucune requête Supabase");
  assert.equal(ecritures(base), 0);
  // Toutes les autres méthodes aussi.
  for (const m of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", ""]) {
    const x = await lancer({ methode: m });
    assert.equal(x.r.status, 405, `méthode ${m || "(vide)"}`);
    assert.equal(x.trace.contexte, 0);
  }
  // La casse du verbe n'est pas une faille : « post » EST un POST.
  assert.equal((await lancer({ methode: "post" })).r.status, 200);
  assert.equal((await lancer({ methode: "PoSt" })).r.status, 200);
});

test("2. secret serveur absent → 500 explicite, aucun appel, valeur jamais révélée", async () => {
  // `undefined` se teste directement sur la porte : le lanceur, lui, a un
  // défaut qui le remplacerait.
  assert.equal((await verifierAppelCron({ methode: "POST", enTeteSecret: SECRET })).status, 500);
  for (const absent of ["", "   ", null, 12345, {}]) {
    const { r, base, progbat, trace } = await lancer({ secretServeur: absent });
    assert.equal(r.status, 500, `secret serveur ${JSON.stringify(absent)}`);
    assert.equal(r.corps.ok, false);
    assert.match(r.corps.error, /non configuré/i);
    assert.ok(r.corps.error.includes(VARIABLE_SECRET), "le NOM de la variable est dit");
    assert.equal(trace.contexte, 0);
    assert.equal(progbat.appels.length, 0);
    assert.equal(base.journal.length, 0);
  }
});

test("3. en-tête absent → 401, aucun appel", async () => {
  // En-tête totalement absent : `req.headers.get()` rendrait null, mais on
  // vérifie aussi `undefined` directement sur la porte.
  assert.equal((await verifierAppelCron({ methode: "POST", secretServeur: SECRET })).status, 401);
  for (const vide of [null, "", 0, false, {}]) {
    const { r, base, progbat, trace } = await lancer({ enTeteSecret: vide });
    assert.equal(r.status, 401, `en-tête ${JSON.stringify(vide)}`);
    assert.equal(r.corps.ok, false);
    assert.match(r.corps.error, /non autorisé/i);
    assert.equal(trace.contexte, 0, "le contexte n'est pas ouvert");
    assert.equal(progbat.appels.length, 0);
    assert.equal(base.journal.length, 0);
  }
});

test("4. mauvais secret → 401, y compris à un caractère près", async () => {
  for (const faux of [
    "mauvais", SECRET + "x", SECRET.slice(0, -1), SECRET.toUpperCase(),
    ` ${SECRET}`, `${SECRET} `, SECRET.replace("3", "e"),
  ]) {
    const { r, base, progbat, trace } = await lancer({ enTeteSecret: faux });
    assert.equal(r.status, 401, `secret « ${faux} »`);
    assert.equal(trace.contexte, 0);
    assert.equal(progbat.appels.length, 0);
    assert.equal(base.journal.length, 0);
  }
  // Le message est le MÊME qu'un en-tête absent : rien ne fuite sur la config.
  const sans = await lancer({ enTeteSecret: null });
  const faux = await lancer({ enTeteSecret: "mauvais" });
  assert.equal(sans.r.corps.error, faux.r.corps.error);
});

test("5. secret correct → le traitement part, et lui seul l'ouvre", async () => {
  const { r, base, progbat, trace } = await lancer();
  assert.equal(r.status, 200);
  assert.equal(r.corps.ok, true);
  assert.equal(trace.contexte, 1, "le contexte est ouvert exactement une fois");
  assert.ok(progbat.appels.length > 0, "ProGBat a bien été lu");
  assert.ok(ecritures(base) > 0, "les factures sont écrites");
});

test("6. une session utilisateur ne vaut pas autorisation", async () => {
  // La porte ne connaît QUE le secret : aucun paramètre d'appelant n'existe.
  const { r, trace } = await lancer({ enTeteSecret: null });
  assert.equal(r.status, 401);
  assert.equal(trace.contexte, 0);
  // Et la fonction ne lit jamais l'en-tête Authorization ni une session.
  assert.ok(!CRON_CODE.includes("auth.getUser("), "aucune session utilisateur lue");
  assert.ok(!CRON_CODE.includes('req.headers.get("Authorization")'), "l'en-tête Authorization entrant n'est pas lu");
  assert.ok(!CRON_CODE.includes("utilisateurs"), "aucune table d'utilisateurs interrogée");
  assert.ok(!CRON_CODE.includes("est_ouvrier"), "aucun contrôle de rôle : ce n'est pas la porte de cette fonction");
  // La confirmation manuelle n'est pas non plus un repli ici.
  assert.ok(!CRON_CODE.includes("SYNCHRONISER_PROGBAT"));
});

test("7, 8, 9. le refus précède le jeton ProGBat, la base et tout fetch", async () => {
  for (const refus of [
    { methode: "GET" }, { secretServeur: "" }, { enTeteSecret: null }, { enTeteSecret: "faux" },
  ]) {
    const { r, base, progbat, trace } = await lancer(refus);
    assert.ok(r.status >= 400, `refus attendu pour ${JSON.stringify(refus)}`);
    assert.equal(trace.jeton, 0, "le jeton ProGBat n'est pas lu");
    assert.equal(base.journal.length, 0, "aucune lecture ni écriture Supabase métier");
    assert.equal(progbat.appels.length, 0, "aucun appel ProGBat");
  }
  // Dans le code : le contexte est une FONCTION, appelée par le module APRÈS
  // la porte — rien n'est construit à l'avance.
  assert.match(CRON_CODE, /ouvrirContexte: async \(\) => \{/);
  const iPorte = CRON_CODE.indexOf("traiterAppelCron({");
  assert.ok(iPorte > 0);
  assert.ok(CRON_CODE.indexOf("choisirJeton(") > iPorte, "le jeton est lu DANS ouvrirContexte");
  assert.ok(CRON_CODE.indexOf("createClient(") > iPorte, "le client Supabase aussi");
  // Et le module vérifie la porte avant d'appeler ouvrirContexte.
  const MOD = lire("src/Renovation/progbatBillingCron.mjs");
  assert.ok(MOD.indexOf("const porte = await verifierAppelCron(") < MOD.indexOf("await ouvrirContexte()"));
});

test("10, 11. le secret ne sort ni en réponse, ni dans les journaux", async () => {
  const cas = [
    await lancer({ enTeteSecret: "mauvais" }),
    await lancer({ enTeteSecret: null }),
    await lancer({ secretServeur: "" }),
    await lancer({ methode: "GET" }),
    await lancer(),
  ];
  for (const { r } of cas) {
    const texte = JSON.stringify(r.corps) + " " + String(r.journal);
    assert.ok(!texte.includes(SECRET), "le secret ne doit apparaître nulle part");
    assert.ok(!texte.includes("mauvais"), "ni la valeur fournie par l'appelant");
  }
  // Statiquement : aucune ligne de log ni de réponse ne porte le secret.
  for (const ligne of CRON_CODE.split("\n")) {
    if (/console\.(log|warn|error)/.test(ligne) || /json\(/.test(ligne)) {
      assert.doesNotMatch(ligne, new RegExp(VARIABLE_SECRET), `secret journalisé : ${ligne.trim()}`);
      assert.doesNotMatch(ligne, /enTeteSecret|x-progbat-cron-secret/, `en-tête journalisé : ${ligne.trim()}`);
    }
  }
  // Le module ne met jamais le secret dans son journal.
  const MOD = lire("src/Renovation/progbatBillingCron.mjs");
  assert.ok(!/journal:[^\n]*secret/i.test(MOD));
});

test("comparaison de secrets : sans sortie anticipée, et strictement exacte", async () => {
  assert.equal(await comparerSecretConstant(SECRET, SECRET), true);
  for (const [a, b] of [
    [SECRET, SECRET + "x"], ["", ""], [SECRET, ""], ["", SECRET],
    [null, SECRET], [SECRET, null], [123, 123], [SECRET, " " + SECRET],
  ]) {
    assert.equal(await comparerSecretConstant(a, b), false, `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  }
  // La comparaison porte sur des condensats de taille FIXE : ni la longueur du
  // secret ni la position du premier écart ne transparaissent.
  const MOD = lire("src/Renovation/progbatBillingCron.mjs");
  assert.match(MOD, /SHA-256/);
  assert.match(MOD, /difference \|= x\[i\] \^ y\[i\]/);
  assert.ok(!/return false;\s*\/\/ dans la boucle/.test(MOD));
  // Aucune comparaison directe de chaînes sur le secret.
  assert.ok(!/enTeteSecret === secretServeur/.test(MOD));
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LE TRAITEMENT — le même moteur que la synchronisation manuelle
// ═══════════════════════════════════════════════════════════════════════════
test("12, 13. rapport complet, declencheur=cron, zéro écriture ProGBat", async () => {
  const { r } = await lancer();
  const c = r.corps;
  assert.equal(c.declencheur, DECLENCHEUR);
  assert.equal(DECLENCHEUR, "cron");
  assert.equal(c.dry_run, false);
  assert.equal(c.ok, true);
  assert.equal(c.partiel, false);
  assert.equal(c.ecritures.progbat, 0, "aucune écriture ProGBat, jamais");
  assert.ok(c.ecritures.supabase > 0);
  assert.deepEqual(Object.keys(c.pagination).sort(), ["bills", "transactions"]);
  assert.equal(c.reconciliation_absence_autorisee, true);
  for (const k of ["creation", "mise_a_jour", "inchangee", "ignoree", "echec"]) {
    assert.equal(typeof c.factures.categories[k], "number", `factures.${k}`);
  }
  for (const k of ["creation", "mise_a_jour", "inchange", "annulation", "deja_annule", "ignore", "echec"]) {
    assert.equal(typeof c.reglements.categories[k], "number", `reglements.${k}`);
  }
  assert.equal(c.erreurs_total, 0);
  assert.deepEqual(c.erreurs, []);
});

test("14. pagination des factures incomplète → abandon, zéro écriture", async () => {
  // a. Erreur de lecture.
  const a = await lancer({ options: { erreurs: { bills: { ok: false, status: 429, message: "429" } } } });
  assert.equal(a.r.status, 429);
  assert.equal(a.r.corps.ok, false);
  assert.equal(a.r.corps.declencheur, "cron");
  assert.equal(a.r.corps.ecritures.supabase, 0);
  assert.equal(ecritures(a.base), 0, "aucune écriture");

  // b. Garde de pages atteinte.
  const bills = Array.from({ length: 200 }, (_, i) => facture({ id: 9000 + i, validated: 1, yardId: 77, toBePaid: 1 }));
  const b = await lancer({ options: { bills, pageSize: 10 }, pageSize: 10, maxPages: 3 });
  assert.equal(b.r.corps.ok, false);
  assert.match(b.r.corps.error, /garde de 3 pages atteinte/);
  assert.equal(ecritures(b.base), 0);
});

test("15. pagination des transactions incomplète → aucune annulation par absence", async () => {
  const base = faireBase(CONTEXTE);
  await lancer({ base });                      // 1re passe : tout est créé
  const avant = ecritures(base);
  const vivants = base.tables[T_REGLEMENTS].map((l) => l.annule);
  assert.deepEqual(vivants, [false]);

  // Transactions illisibles : la réconciliation par absence est interdite.
  const { r } = await lancer({ base, options: { erreurs: { transactions: { ok: false, status: 500, message: "500" } } } });
  assert.equal(r.corps.reconciliation_absence_autorisee, false);
  assert.equal(r.corps.reglements.categories.annulation, 0);
  assert.equal(r.corps.reglements.categories.deja_annule, 0);
  assert.deepEqual(base.tables[T_REGLEMENTS].map((l) => l.annule), [false],
    "le règlement reste vivant");
  assert.equal(ecritures(base), avant, "aucune écriture déclenchée par une absence non fiable");
});

test("16. échec d'écriture → ok:false et partiel correctement calculé", async () => {
  // La facture 1002 est refusée, la 1001 passe : partiel.
  const base = faireBase({
    ...CONTEXTE,
    pannes: (op, table, ligne) =>
      (op === "insert" && table === T_FACTURES && ligne?.progbat_bill_id === 1002 ? "colonne refusée" : null),
  });
  const { r } = await lancer({ base });
  assert.equal(r.status, 207, "un échec ne devient jamais un 200");
  assert.equal(r.corps.ok, false);
  assert.equal(r.corps.partiel, true);
  assert.equal(r.corps.declencheur, "cron");
  assert.equal(r.corps.factures.categories.creation, 1);
  assert.equal(r.corps.factures.categories.echec, 1);
  assert.equal(r.corps.erreurs_total, 1);
  assert.equal(r.corps.erreurs[0].reference, 1002);

  // Échec TOTAL : raté, mais pas « partiel ».
  const tout = faireBase({ ...CONTEXTE, pannes: (op) => (op === "insert" ? "refusée" : null) });
  const t = await lancer({ base: tout });
  assert.equal(t.r.corps.ok, false);
  assert.equal(t.r.corps.partiel, false);
  assert.equal(t.r.corps.ecritures.supabase, 0);
});

test("17. deuxième passe horaire : zéro écriture, base inchangée", async () => {
  const base = faireBase(CONTEXTE);
  const un = await lancer({ base });
  assert.equal(un.r.corps.ok, true);
  const apres1 = JSON.stringify(base.tables);
  const ecritures1 = ecritures(base);
  assert.ok(ecritures1 > 0);

  const deux = await lancer({ base });
  assert.equal(deux.r.corps.ok, true);
  assert.equal(deux.r.corps.ecritures.supabase, 0, "l'heure suivante n'écrit rien");
  assert.equal(deux.r.corps.factures.categories.creation, 0);
  assert.equal(deux.r.corps.factures.categories.mise_a_jour, 0);
  assert.equal(deux.r.corps.reglements.categories.creation, 0);
  assert.equal(JSON.stringify(base.tables), apres1, "la base est identique à l'octet près");
  assert.equal(ecritures(base), ecritures1);
});

test("concurrence manuel / cron : l'index unique tranche, la passe suivante converge", async () => {
  // Une synchronisation manuelle crée la facture 1001 pendant que le cron
  // s'apprête à l'insérer. La base refuse le doublon.
  let injecte = false;
  let hook = null;
  const base = faireBase({ ...CONTEXTE, pannes: (...a) => (hook ? hook(...a) : null) });
  hook = (op, table, ligne) => {
    if (!injecte && op === "insert" && table === T_FACTURES && ligne?.progbat_bill_id === 1001) {
      injecte = true;
      base.tables[T_FACTURES].push(versBase({
        id: "f-manuelle", source: "progbat", progbat_bill_id: 1001, chantier_id: "tilleuls",
        progbat_validated: 1, progbat_to_be_paid: 925.15, montant_ttc: 925.15,
      }));
    }
    return null;
  };
  const { r } = await lancer({ base });
  assert.equal(r.corps.ok, false, "le conflit est rapporté");
  assert.equal(r.corps.partiel, true);
  assert.match(r.corps.erreurs[0].message, /unique/i);
  assert.equal(base.tables[T_FACTURES].filter((l) => l.progbat_bill_id === 1001).length, 1, "aucun doublon");

  hook = null;
  const reprise = await lancer({ base });
  assert.equal(reprise.r.corps.ok, true, "la passe horaire suivante converge");
  assert.equal(base.tables[T_FACTURES].filter((l) => l.progbat_bill_id === 1001).length, 1);
});

test("aucune donnée nominative ni bancaire dans le rapport horaire", async () => {
  const { r } = await lancer();
  const texte = JSON.stringify(r.corps) + " " + r.journal;
  for (const valeur of ["SCI DUPONT", "VIR SEPA", "clientName", "label", "payload", "token"]) {
    assert.ok(!texte.includes(valeur), `« ${valeur} » ne doit pas sortir`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CONFIGURATION JWT ET FONCTION MANUELLE
// ═══════════════════════════════════════════════════════════════════════════
test("18. vérification JWT désactivée UNIQUEMENT pour la fonction cron", () => {
  // Une seule désactivation dans tout le fichier.
  const desactivations = CONFIG_CODE.match(/verify_jwt\s*=\s*false/g) || [];
  assert.equal(desactivations.length, 1, "une seule fonction sans JWT");
  // Et c'est bien celle du cron.
  assert.match(CONFIG_CODE, /\[functions\.progbat-billing-sync-cron\]\s*\nverify_jwt\s*=\s*false/);
  // La synchronisation manuelle garde son JWT, explicitement.
  assert.match(CONFIG_CODE, /\[functions\.progbat-billing-sync\]\s*\nverify_jwt\s*=\s*true/);
  assert.match(CONFIG_CODE, /\[functions\.progbat-billing-dry-run\]\s*\nverify_jwt\s*=\s*true/);
  // Aucune désactivation globale.
  assert.ok(!/^\s*verify_jwt\s*=\s*false/m.test(CONFIG_CODE.replace(/\[functions\.progbat-billing-sync-cron\][\s\S]*?\n\n/, "")),
    "aucune désactivation hors de la fonction cron");
  // Toutes les fonctions du dépôt sont listées : aucune ne peut s'ouvrir par omission.
  const dossier = fileURLToPath(new URL("../supabase/functions", import.meta.url));
  for (const fn of readdirSync(dossier, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    assert.ok(CONFIG_CODE.includes(`[functions.${fn}]`), `${fn} doit être déclarée dans config.toml`);
  }
});

test("19. la fonction MANUELLE garde ses trois verrous, inchangée", () => {
  // Session utilisateur…
  assert.match(MANUEL_CODE, /auth\.getUser\(jwt\)/);
  assert.match(MANUEL_CODE, /Non authentifié/);
  // …rôle bureau…
  assert.match(MANUEL_CODE, /profil\.actif === false/);
  assert.match(MANUEL_CODE, /profil\.role === "ouvrier"/);
  // …et confirmation exacte.
  assert.match(MANUEL_CODE, /verifierConfirmation\(corps\)/);
  assert.ok(MANUEL_CODE.indexOf('profil.role === "ouvrier"') < MANUEL_CODE.indexOf("verifierConfirmation("));
  // Le secret du cron n'y est pas : les deux portes restent séparées.
  assert.ok(!MANUEL_CODE.includes(VARIABLE_SECRET));
  assert.ok(!MANUEL_CODE.includes(EN_TETE_SECRET));
  assert.ok(!MANUEL_CODE.includes("traiterAppelCron"));
  // Et son rapport ne porte PAS de declencheur : il n'a pas changé.
  assert.ok(!MANUEL_CODE.includes("declencheur"));
});

test("cron : GET seul vers ProGBat, service_role côté serveur, aucun cron créé ici", () => {
  const verbes = [...new Set(CRON_CODE.match(/method:\s*"[A-Z]+"/g) || [])];
  assert.deepEqual(verbes, ['method: "GET"'], "un seul verbe sortant");
  assert.equal((CRON_CODE.match(/fetch\(/g) || []).length, 1);
  assert.doesNotMatch(CRON_CODE, /\/pdf/);
  // service_role : lu depuis l'environnement, jamais renvoyé ni journalisé.
  assert.match(CRON_CODE, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(CRON_CODE, /json\([^)]*SERVICE_ROLE/);
  assert.doesNotMatch(CRON_CODE, /console\.[a-z]+\([^)]*SERVICE_ROLE/);
  // Ce lot ne crée aucun cron ni aucune migration.
  assert.ok(!CRON_CODE.includes("cron.schedule"));
  assert.ok(!CRON_CODE.includes("pg_cron"));
  // L'en-tête et la variable portent bien les noms demandés.
  assert.equal(EN_TETE_SECRET, "x-progbat-cron-secret");
  assert.equal(VARIABLE_SECRET, "PROGBAT_BILLING_CRON_SECRET");
  assert.match(CRON_CODE, /req\.headers\.get\(EN_TETE_SECRET\)/);
  assert.match(CRON_CODE, /Deno\.env\.get\(VARIABLE_SECRET\)/);
});

test("cron : aucune règle métier réécrite, copies lib à jour", async () => {
  const MOD = lire("src/Renovation/progbatBillingCron.mjs");
  assert.match(MOD, /from "\.\/progbatBillingSync\.mjs"/);
  for (const interdit of [
    "function normaliserFactureProgbat", "function fusionnerFactureProgbat",
    "function analyserFactures", "function analyserReglements",
    "function preparerSynchronisation", "function executerSynchronisation",
  ]) {
    assert.ok(!MOD.includes(interdit), `${interdit} ne doit pas être réécrit`);
  }
  const { verifierCopies, CIBLES } = await import(new URL("../scripts/sync-progbat-edge-lib.mjs", import.meta.url).href);
  assert.deepEqual(verifierCopies(), [], "node scripts/sync-progbat-edge-lib.mjs");
  assert.deepEqual(CIBLES["progbat-billing-sync-cron"], [
    "progbatFacturation.mjs", "progbatLiaison.mjs", "progbatYards.mjs",
    "progbatBillingDryRun.mjs", "progbatBillingSync.mjs", "progbatBillingCron.mjs",
  ]);
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
console.log(`\nverif-progbat-billing-sync-cron : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
