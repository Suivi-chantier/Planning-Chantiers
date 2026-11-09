#!/usr/bin/env node
// Vérifie le point du soir des conducteurs, C1 + C2 (projet
// docs/projets/notifications-push.md, tâche 4).
//
//   1. src/Renovation/ouvriersAttendusV1.mjs — comparé à une copie de l'ANCIEN
//      code du mail de rappel (cron-rappel-rapport.js avant l'extraction) :
//      mêmes ouvriers attendus, même identifiant de semaine ;
//   2. le mail de rappel importe le module, n'a plus sa copie, et — exécuté sur
//      une base et un envoi de mail simulés — relance les mêmes ouvriers, avec
//      le même objet et le même lien ;
//   3. src/Renovation/pointConducteursV1.mjs : titre, texte, coupe propre
//      (« … et K autres »), rien à dire = rien, attendus sans aucun CR = envoi ;
//   4. préférences C1 / C2 : envoi groupé (supabase/functions/_partage/
//      pushGroupeV1.mjs) = un seul push par personne, et jamais le contenu
//      d'un type coupé ;
//   5. le job ?job=point_conducteurs : base et send-push simulés — aucun appel
//      si rien à dire, erreur si une lecture échoue, pas_avant, date réservée
//      à la simulation, second créneau sans doublon ;
//   6. branchements : dispatcher, créneau GitHub 18h30 été / hiver, workflow.
//
// Données fictives uniquement. Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-point-conducteurs.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as A from "../src/Renovation/ouvriersAttendusV1.mjs";
import * as P from "../src/Renovation/pointConducteursV1.mjs";
import * as G from "../supabase/functions/_partage/pushGroupeV1.mjs";
import * as V from "../supabase/functions/_partage/notificationsPushV1.mjs";

const require = createRequire(import.meta.url);
const chemin = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const lire = (rel) => readFileSync(chemin(rel), "utf8");
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Copie de l'ANCIEN code du rappel (avant la tâche 4), servant d'oracle ────
function ancienAssignes(cells) {
  const assignes = new Set();
  (cells || []).forEach(cell => {
    const aUneTache = (cell.taches && cell.taches.length > 0)
      || (cell.planifie && cell.planifie.trim().length > 0);
    if (!aUneTache) return;
    (cell.ouvriers || []).forEach(nom => { if (nom) assignes.add(nom); });
  });
  return assignes;
}
// Ancien currentWeekIdParis(), la date « YYYY-MM-DD » de Paris en paramètre.
function ancienneSemaine(fmt) {
  const [y, m, d] = fmt.split("-").map(Number);
  const local = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const jan1  = new Date(Date.UTC(y, 0, 1, 12, 0, 0));
  const dayOfYear = Math.floor((local - jan1) / 86400000) + 1;
  const w = Math.ceil((dayOfYear + jan1.getUTCDay()) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

// Données fictives (prénoms et chantiers inventés).
const CELLS = [
  { ouvriers: ["Alpha", "Bravo"], taches: [{ id: "t1" }], planifie: "" },
  { ouvriers: ["Charlie"], taches: [], planifie: "Pose placo" },
  { ouvriers: ["Delta"], taches: [], planifie: "   " },          // aucune tâche : pas attendu
  { ouvriers: ["Echo", "", null], taches: null, planifie: null }, // aucune tâche
  { ouvriers: ["Alpha"], taches: [{ id: "t2" }] },                // doublon
  { taches: [{ id: "t3" }] },                                     // sans ouvriers
];

// ═══ 1. Règle « ouvriers attendus » ═════════════════════════════════════════
test("1. ouvriers attendus : identique à l'ancien code du rappel", () => {
  assert.deepEqual([...A.ouvriersAttendus(CELLS)], [...ancienAssignes(CELLS)]);
  assert.deepEqual([...A.ouvriersAttendus(CELLS)].sort(), ["Alpha", "Bravo", "Charlie"]);
  assert.equal(A.ouvriersAttendus([]).size, 0);
  assert.equal(A.ouvriersAttendus(null).size, 0);
});

test("2. identifiant de semaine : identique à l'ancien currentWeekIdParis, toute l'année", () => {
  for (const annee of [2025, 2026, 2027, 2028]) {
    for (let jour = 0; jour < 366; jour++) {
      const d = new Date(Date.UTC(annee, 0, 1 + jour));
      if (d.getUTCFullYear() !== annee) continue;
      const iso = d.toISOString().slice(0, 10);
      assert.equal(A.semaineDuJour(iso), ancienneSemaine(iso), iso);
    }
  }
  assert.equal(A.semaineDuJour("2026-11-02"), "2026-W45");
  assert.equal(A.jourPlanning("2026-11-02"), "Lundi");
  assert.equal(A.jourPlanning("2026-11-06"), "Vendredi");
  assert.equal(A.jourPlanning("2026-11-07"), null, "samedi");
  assert.equal(A.jourPlanning("2026-11-08"), null, "dimanche");
  assert.equal(A.dateFrDepuisIso("2026-11-02"), "02/11/2026");
});

// ═══ 2. Le mail de rappel utilise le module et reste identique ══════════════
test("3. le rappel importe le module partagé et n'a plus sa propre copie", () => {
  const code = sansCommentaires(lire("api/_cron/cron-rappel-rapport.js"));
  assert.match(code, /import\("\.\.\/\.\.\/src\/Renovation\/ouvriersAttendusV1\.mjs"\)/);
  assert.match(code, /const assignes = ouvriersAttendus\(cells\);/);
  assert.match(code, /const weekId = semaineDuJour\(t\.dateIso\);/);
  assert.ok(!/aUneTache/.test(code), "plus de copie de la règle");
  assert.ok(!/currentWeekIdParis/.test(code), "plus de calcul de semaine local");
  const job = sansCommentaires(lire("api/_cron/cron-point-conducteurs.js"));
  assert.match(job, /src\/Renovation\/ouvriersAttendusV1\.mjs/);
  assert.match(job, /ouvriersAttendus\(d\.cells\)/);
  assert.ok(!/aUneTache/.test(job), "le point du soir n'a pas de copie de la règle");
});

// Base simulée : chaque requête renvoie les lignes de sa table, filtrées par eq / in.
function fausseBase(tables, { erreurs = {}, ecritures = [] } = {}) {
  return {
    from(table) {
      const filtres = [];
      const q = {
        select() { return q; },
        eq(col, val) { filtres.push((r) => r[col] === val); return q; },
        in(col, vals) { filtres.push((r) => vals.includes(r[col])); return q; },
        order() { return q; },
        limit() { return q; },
        range() { return q; },
        maybeSingle() { return Promise.resolve(resultat(true)); },
        upsert(v) { ecritures.push({ table, v }); return Promise.resolve({ error: null }); },
        update(v) { ecritures.push({ table, v }); return q; },
        insert(v) { ecritures.push({ table, v }); return q; },
        then(ok, ko) { return Promise.resolve(resultat(false)).then(ok, ko); },
      };
      function resultat(seul) {
        if (erreurs[table]) return { data: null, error: { message: erreurs[table] } };
        const lignes = (tables[table] || []).filter((r) => filtres.every((f) => f(r)));
        return { data: seul ? (lignes[0] ?? null) : lignes, error: null };
      }
      return q;
    },
  };
}

// Envoi simulé : on capture les appels HTTP (mails et send-push).
const appels = [];
globalThis.fetch = async (url, init) => {
  const corps = init?.body ? JSON.parse(init.body) : null;
  appels.push({ url: String(url), corps });
  if (String(url).includes("/functions/v1/send-push")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, simulation: corps?.simulation === true, ecrites_en_boite: 0, ...(corps?.groupe && !globalThis.__sendPushAncien ? { groupe: true } : {}) }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};
process.env.CRON_SECRET = process.env.CRON_SECRET || "secret-fictif-de-test";
process.env.VITE_SUPABASE_URL = "https://exemple.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-fictive";

test("4. mail de rappel exécuté : mêmes ouvriers relancés, même objet, même lien", async () => {
  const { runRappelRapport } = require("../api/_cron/cron-rappel-rapport.js");
  const t = { weekday: "Lundi", dateFr: "02/11/2026", dateIso: "2026-11-02", hour: 17, minute: 50, year: 2026 };
  const base = fausseBase({
    planning_config: [
      { key: "ouvrier_emails", value: { Alpha: "alpha@exemple.invalid", Bravo: "bravo@exemple.invalid", Charlie: "charlie@exemple.invalid" } },
      { key: "rappels_rapport_state", value: { date: null, prenoms: [] } },
      { key: "bloc_todos", value: [] },
    ],
    planning_cells: CELLS.map((c) => ({ ...c, week_id: "2026-W45", jour: "Lundi" }))
      .concat([{ ouvriers: ["Zoulou"], taches: [{ id: "x" }], week_id: "2026-W44", jour: "Lundi" }]),
    rapports: [{ ouvrier: "Alpha", date_rapport: "02/11/2026" }, { ouvrier: "Bravo", date_rapport: "01/11/2026" }],
  });
  appels.length = 0;
  const req = { headers: { host: "exemple.invalid", "x-forwarded-proto": "https" } };
  const r = await runRappelRapport(req, base, t);
  assert.equal(r.weekId, "2026-W45");
  assert.equal(r.rapports.assignes, 3);
  assert.equal(r.rapports.rendus, 1);
  assert.deepEqual(r.rapports.envoyes.sort(), ["Bravo", "Charlie"]);
  const mails = appels.filter((a) => a.url.endsWith("/api/send-email"));
  assert.equal(mails.length, 2);
  for (const m of mails) {
    assert.equal(m.corps.subject, "📝 Rappel : votre compte rendu du 02/11/2026");
    assert.match(m.corps.html, /https:\/\/planning-chantiers\.vercel\.app\/rapport#rapport/);
    assert.match(m.corps.html, /Merci de remplir votre compte rendu du <strong>02\/11\/2026<\/strong>/);
  }
  assert.deepEqual(mails.map((m) => m.corps.to).sort(), ["bravo@exemple.invalid", "charlie@exemple.invalid"]);
});

// ═══ 3. Contenu du point du soir ════════════════════════════════════════════
const BESOINS = [
  { id: "b1", panier_id: "p1", chantier_id: "ch-a", article: "Vis placo", quantite: "2", ouvrier_demandeur: "Alpha", statut: "en_attente", created_at: "2026-11-02T08:00:00Z" },
  { id: "b2", panier_id: "p1", chantier_id: "ch-a", article: "Bande à joint", quantite: "1", ouvrier_demandeur: "Alpha", statut: "en_attente", created_at: "2026-11-02T08:00:00Z" },
  { id: "b3", panier_id: null, chantier_id: "ch-b", article: "Disjoncteur", quantite: "3", ouvrier_demandeur: "Bravo", statut: "en_attente", created_at: "2026-11-02T09:00:00Z" },
];
const CHANTIERS = [{ id: "ch-a", nom: "CHANTIER FICTIF A" }, { id: "ch-b", nom: "CHANTIER FICTIF B" }];
const point = (o = {}) => P.pointDuSoir({
  dateIso: "2026-11-02", attendus: new Set(["Alpha", "Bravo", "Charlie"]),
  rapports: [{ ouvrier: "Alpha" }, { ouvrier: "Alpha" }], besoins: BESOINS, chantiers: CHANTIERS,
  lienPage: V.lienPage, ...o,
});

test("5. point complet : titre court, manquants nommés, demandes par chantier, liens", () => {
  const p = point();
  assert.equal(p.cle_regroupement, "C1-2026-11-02");
  assert.equal(p.comptesRendus.recus, 1, "un ouvrier a rendu (deux CR sur deux chantiers)");
  assert.deepEqual(p.comptesRendus.manquants, ["Bravo", "Charlie"]);
  assert.equal(p.demandes.length, 2, "regroupées par envoi (panier)");
  assert.equal(p.ensemble.titre, "Point du soir : 1 CR reçu, 2 manquants, 2 demandes de matériel");
  assert.equal(p.c1.titre, "Point du soir : 1 CR reçu, 2 manquants");
  assert.equal(p.c2.titre, "Point du soir : 2 demandes de matériel en attente");
  assert.match(p.c1.texte, /Manquants \(2\) : Bravo, Charlie\./);
  assert.match(p.c2.texte, /CHANTIER FICTIF A \(Alpha\) : Vis placo ×2, Bande à joint ×1/);
  assert.match(p.c2.texte, /CHANTIER FICTIF B \(Bravo\) : Disjoncteur ×3/);
  assert.equal(p.c1.lien, "/?page=validation");
  assert.equal(p.c2.lien, "/?page=planning-commandes");
  assert.equal(p.ensemble.lien, p.c1.lien);
  assert.equal(p.ensemble.texte, `${p.c1.texte}\n${p.c2.texte}`);
  for (const partie of [p.c1, p.c2, { ...p.ensemble, type: "C1" }]) {
    assert.equal(V.validerContenu({ ...partie, cle_regroupement: p.cle_regroupement }).ok, true, "accepté par send-push");
    assert.ok(partie.titre.length <= 120 && partie.texte.length <= 1000);
  }
  // Les pages existent bien dans src/access.js.
  const acces = lire("src/access.js");
  assert.match(acces, /\{ id: "validation",/);
  assert.match(acces, /\{ id: "planning-commandes",/);
});

test("6. liste trop longue : coupée proprement avec « … et K autres »", () => {
  const noms = Array.from({ length: 200 }, (_, i) => `Ouvrier${String(i).padStart(3, "0")}`);
  const p = point({ attendus: new Set(noms), rapports: [] });
  assert.match(p.c1.texte, / … et \d+ autres\.$/);
  const k = Number(p.c1.texte.match(/… et (\d+) autres/)[1]);
  const affiches = p.c1.texte.split(" : ")[1].split(" … ")[0].split(", ").length;
  assert.equal(affiches + k, 200, "aucun nom perdu dans le décompte");
  assert.ok(p.ensemble.texte.length <= 1000);
  assert.equal(P.listeCoupee(["a", "b"], 100), "a, b");
  assert.equal(P.listeCoupee(["aaaa", "bbbb", "cccc"], 12), "aaaa … et 2 autres");
  const beaucoup = Array.from({ length: 60 }, (_, i) => ({ ...BESOINS[2], id: `x${i}`, panier_id: `px${i}`, article: `Article fictif numéro ${i}` }));
  assert.match(point({ besoins: beaucoup }).c2.texte, /… et \d+ autres\.$/);
});

test("7. rien à signaler : aucune notification", () => {
  const p = point({ attendus: new Set(), rapports: [], besoins: [] });
  assert.equal(p, null);
  assert.equal(P.demandeSendPush(p), null);
  // Une demande déjà traitée n'est pas « en attente ».
  assert.equal(point({ attendus: new Set(), rapports: [], besoins: [{ ...BESOINS[0], statut: "traite" }] }), null);
});

test("8. ouvriers attendus et AUCUN compte rendu reçu : on envoie", () => {
  const p = point({ rapports: [], besoins: [] });
  assert.ok(p && p.c1, "une absence ne passe pas pour « tout va bien »");
  assert.equal(p.c1.titre, "Point du soir : aucun CR reçu, 3 manquants");
  assert.match(p.c1.texte, /Aucun compte rendu reçu sur 3 ouvriers attendus\. Manquants : Alpha, Bravo, Charlie\./);
  assert.equal(p.c2, null);
  assert.equal(p.ensemble, null);
  const corps = P.demandeSendPush(p);
  assert.equal(corps.type, "C1");
  assert.equal(corps.groupe, undefined, "une seule partie : envoi simple");
  assert.equal(corps.cle_regroupement, "C1-2026-11-02");
});

test("9. tous rendus : C1 envoyé avec « tous ont rendu » ; demandes seules : C2 seul", () => {
  const tous = point({ rapports: ["Alpha", "Bravo", "Charlie"].map((o) => ({ ouvrier: o })), besoins: [] });
  assert.equal(tous.c1.titre, "Point du soir : 3 CR reçus, 0 manquant");
  assert.match(tous.c1.texte, /tous les ouvriers attendus ont rendu le leur \(3\)/);
  const seul = point({ attendus: new Set(), rapports: [] });
  assert.equal(seul.c1, null);
  const corps = P.demandeSendPush(seul, { simulation: true });
  assert.equal(corps.type, "C2");
  assert.equal(corps.simulation, true);
  assert.equal(corps.cle_regroupement, "C1-2026-11-02");
  const deux = P.demandeSendPush(point());
  assert.equal(deux.type, "C1");
  assert.equal(deux.groupe.type, "C2");
  assert.ok(deux.groupe.ensemble.titre.startsWith("Point du soir : 1 CR reçu"));
  assert.throws(() => P.clePointDuSoir(""), /Date de Paris illisible/);
});

// ═══ 4. Préférences C1 / C2 : un seul push, jamais le contenu d'un type coupé ═
const UTILISATEURS = [
  { auth_id: "u1", nom: "Admin Un", role: "admin", actif: true },      // reçoit tout
  { auth_id: "u2", nom: "Admin Deux", role: "admin", actif: true },    // a coupé C2
  { auth_id: "u3", nom: "Conducteur", role: "conducteur", actif: true }, // a coupé C1
  { auth_id: "u4", nom: "Admin Quatre", role: "admin", actif: true },  // a coupé les deux
  { auth_id: "o1", nom: "Ouvrier", role: "ouvrier", actif: true },     // jamais
  { auth_id: "k1", nom: "Comptable", role: "comptable", actif: true }, // pas coché
];
const PREFS = { u2: { C2: false }, u3: { C1: false }, u4: { C1: false, C2: false } };
const LUNDI_18H30 = Date.parse("2026-11-02T17:30:00Z"); // 18h30 Paris (hiver)

function simulerSendPush(reglages, p = point()) {
  const corps = P.demandeSendPush(p);
  const contenu = V.validerContenu(corps);
  const g = G.validerGroupe(corps, contenu);
  assert.equal(g.ok, true);
  const parties = [contenu, g.groupe].filter(Boolean);
  const crees = [];
  let n = 0;
  for (const partie of parties) {
    const plan = V.planifierEnvoi({
      reglages, type: partie.type, cle: contenu.cle_regroupement, utilisateurs: UTILISATEURS, preferences: PREFS,
      appareils: { u1: 1, u2: 1, u3: 1, u4: 1, o1: 1, k1: 1 }, maintenantMs: LUNDI_18H30, vapidConfiguree: true,
    });
    for (const l of plan.lignes) crees.push({ id: `n${n++}`, user_id: l.user_id, type: partie.type, titre: partie.titre, texte: partie.texte, lien: partie.lien, push_statut: l.push_statut });
  }
  const envois = G.envoisParPersonne({ lignes: crees, typePrincipal: contenu.type, ensemble: g.groupe?.ensemble ?? null });
  return { crees, envois, par: Object.fromEntries(envois.map((e) => [e.user_id, e])) };
}

test("10. préférences respectées, un seul push par personne", () => {
  const reglages = { ...V.normaliserReglages({ actif: true }) };
  const p = point();
  const { crees, envois, par } = simulerSendPush(reglages, p);
  assert.equal(new Set(envois.map((e) => e.user_id)).size, envois.length, "un seul push par personne");
  assert.deepEqual(Object.keys(par).sort(), ["u1", "u2", "u3"]);
  assert.equal(par.u1.notif.titre, p.ensemble.titre, "les deux parties : contenu commun");
  assert.equal(par.u1.ids.length, 2, "les deux lignes de la boîte sont marquées");
  assert.equal(par.u2.notif.titre, p.c1.titre, "C2 coupé : seulement les comptes rendus");
  assert.ok(!/matériel/.test(par.u2.notif.titre + par.u2.notif.texte), "rien de C2 pour qui l'a coupé");
  assert.equal(par.u3.notif.titre, p.c2.titre, "C1 coupé : seulement les demandes");
  assert.ok(!/\bCR\b|[Cc]ompte rendu|[Cc]omptes rendus|Manquants/.test(par.u3.notif.titre + par.u3.notif.texte), "rien de C1 pour qui l'a coupé");
  assert.equal(par.u4, undefined, "les deux coupés : aucun push");
  // Les deux restent dans la boîte (préférence coupée = « desactive », règle de la tâche 2).
  assert.deepEqual(crees.filter((c) => c.user_id === "u4").map((c) => c.push_statut), ["desactive", "desactive"]);
  assert.ok(!crees.some((c) => c.user_id === "o1" || c.user_id === "k1"), "ni ouvrier ni rôle non coché");
});

test("11. type C2 désactivé dans les Réglages : C1 seul, avec son propre contenu", () => {
  const reglages = V.normaliserReglages({ actif: true, types: { C2: { actif: false, roles: ["admin"] } } });
  const { crees, par } = simulerSendPush(reglages);
  assert.ok(!crees.some((c) => c.type === "C2"));
  assert.equal(par.u1.notif.type, "C1");
  assert.equal(par.u1.notif.titre, point().c1.titre);
  const coupe = simulerSendPush(V.normaliserReglages(null));
  assert.equal(coupe.crees.length, 0, "interrupteur général coupé (livraison) : rien");
});

test("12. envoi groupé : validation du champ groupe", () => {
  const corps = P.demandeSendPush(point());
  const contenu = V.validerContenu(corps);
  assert.equal(G.validerGroupe({}, contenu).groupe, null);
  assert.equal(G.validerGroupe({ groupe: { ...corps.groupe, type: "C1" } }, contenu).ok, false, "deux fois le même type");
  assert.equal(G.validerGroupe({ groupe: { ...corps.groupe, type: "Z9" } }, contenu).ok, false);
  assert.equal(G.validerGroupe({ groupe: { ...corps.groupe, lien: "https://ailleurs.fr" } }, contenu).ok, false);
  assert.equal(G.validerGroupe({ groupe: { ...corps.groupe, ensemble: { titre: "" } } }, contenu).ok, false);
  assert.equal(G.validerGroupe(corps, { ...contenu, cle_regroupement: null }).ok, false, "clé obligatoire");
  const sim = G.simulationParPersonne({
    lignesPrincipal: [{ user_id: "u1", nom: "A", role: "admin", push_statut: "a_envoyer" }],
    lignesGroupe: [{ user_id: "u1", nom: "A", role: "admin", push_statut: "a_envoyer" }],
    typePrincipal: "C1", typeGroupe: "C2",
  });
  assert.equal(sim[0].push, "un seul push (les deux parties)");
});

test("13. send-push branche l'envoi groupé sans toucher aux autres modes", () => {
  const envoi = sansCommentaires(lire("supabase/functions/send-push/index.ts"));
  assert.match(envoi, /from "\.\.\/_partage\/pushGroupeV1\.mjs"/);
  assert.match(envoi, /const g = validerGroupe\(corps, contenu\)/);
  assert.match(envoi, /envoisParPersonne\(\{ lignes: crees/);
  const bloc = envoi.slice(envoi.indexOf("async function modeServeurGroupe"), envoi.indexOf("async function modeReportes"));
  assert.match(bloc, /onConflict: "user_id,type,cle_regroupement", ignoreDuplicates: true/);
  assert.match(bloc, /planifierEnvoi\(/, "même moteur : rôles, interrupteur, préférences, silence");
  assert.match(bloc, /if \(contenu\.simulation\)/);
  for (const f of ["supabase/functions/_partage/pushGroupeV1.mjs", "src/Renovation/pointConducteursV1.mjs", "src/Renovation/ouvriersAttendusV1.mjs"]) {
    const code = sansCommentaires(lire(f));
    assert.ok(!/supabase/i.test(code.replace(/supabase\/functions/g, "")), `${f} : pas de Supabase`);
    assert.ok(!/Date\.now|new Date\(\)|Math\.random|fetch\(|setTimeout/.test(code), `${f} : pas d'horloge ni d'effet`);
  }
  assert.match(lire("src/Renovation/pointConducteursV1.js"), /export \* from "\.\/pointConducteursV1\.mjs"/);
  assert.match(lire("src/Renovation/ouvriersAttendusV1.js"), /export \* from "\.\/ouvriersAttendusV1\.mjs"/);
});

// ═══ 5. Le job ?job=point_conducteurs ══════════════════════════════════════
const { runPointConducteurs, lirePasAvant } = require("../api/_cron/cron-point-conducteurs.js");
const T_18H30 = { weekday: "Lundi", dateIso: "2026-11-02", dateFr: "02/11/2026", hour: 18, minute: 30 };
const baseJob = (o = {}) => fausseBase({
  planning_cells: CELLS.map((c) => ({ ...c, week_id: "2026-W45", jour: "Lundi" })),
  rapports: [{ ouvrier: "Alpha", date_rapport: "02/11/2026" }],
  besoins: BESOINS,
  chantiers: CHANTIERS,
  notifications: [],
  ...o,
});
const appelsSendPush = () => appels.filter((a) => a.url.includes("/functions/v1/send-push"));

test("14. job : point complet → un appel send-push groupé, clé C1-<date>", async () => {
  appels.length = 0;
  const r = await runPointConducteurs({ query: { pas_avant: "18:30" } }, baseJob(), T_18H30);
  const sp = appelsSendPush();
  assert.equal(sp.length, 1);
  assert.equal(sp[0].corps.mode, "serveur");
  assert.equal(sp[0].corps.type, "C1");
  assert.equal(sp[0].corps.groupe.type, "C2");
  assert.equal(sp[0].corps.cle_regroupement, "C1-2026-11-02");
  assert.equal(sp[0].corps.simulation, false);
  assert.deepEqual(r.comptes_rendus.manquants, ["Bravo", "Charlie"]);
  // Un send-push qui ne connaîtrait pas l'envoi groupé : erreur visible, jamais un C2 perdu en silence.
  globalThis.__sendPushAncien = true;
  try {
    await assert.rejects(runPointConducteurs({ query: {} }, baseJob(), T_18H30), /envoi groupé/);
  } finally { globalThis.__sendPushAncien = false; }
});

test("15. job : rien à dire → aucun appel ; attendus sans CR → appel", async () => {
  appels.length = 0;
  const vide = await runPointConducteurs({ query: {} }, baseJob({ planning_cells: [], rapports: [], besoins: [] }), T_18H30);
  assert.equal(vide.envoi, "aucun");
  assert.equal(appelsSendPush().length, 0);
  const sansCr = await runPointConducteurs({ query: {} }, baseJob({ rapports: [], besoins: [] }), T_18H30);
  assert.equal(appelsSendPush().length, 1);
  assert.equal(appelsSendPush()[0].corps.titre, "Point du soir : aucun CR reçu, 3 manquants");
  assert.equal(sansCr.comptes_rendus.recus, 0);
});

test("16. job : une lecture en échec est une erreur, jamais une liste vide", async () => {
  for (const table of ["planning_cells", "rapports", "besoins", "chantiers", "notifications"]) {
    appels.length = 0;
    await assert.rejects(
      runPointConducteurs({ query: {} }, fausseBase({ notifications: [] }, { erreurs: { [table]: "panne fictive" } }), T_18H30),
      /impossible/, table,
    );
    assert.equal(appelsSendPush().length, 0, `${table} : aucun envoi`);
  }
});

test("17. job : pas_avant, week-end, date réservée à la simulation, second créneau sans doublon", async () => {
  assert.equal(lirePasAvant("18:30"), 18 * 60 + 30);
  assert.equal(lirePasAvant("8"), 8 * 60);
  assert.equal(lirePasAvant("25:00"), null);
  appels.length = 0;
  const tot = await runPointConducteurs({ query: { pas_avant: "18:30" } }, baseJob(), { ...T_18H30, hour: 17, minute: 30 });
  assert.match(tot.ignore, /passage réservé à 18:30/);
  const presque = await runPointConducteurs({ query: { pas_avant: "18:30" } }, baseJob(), { ...T_18H30, hour: 18, minute: 29 });
  assert.ok(presque.ignore);
  assert.equal(appelsSendPush().length, 0, "pas de push avant 18h30");
  await assert.rejects(runPointConducteurs({ query: { date: "2026-11-03" } }, baseJob(), T_18H30), /qu'en simulation/);
  const we = await runPointConducteurs({ query: { simulation: "1", date: "2026-11-07" } }, baseJob(), T_18H30);
  assert.equal(we.skipped, "weekend");
  // Simulation d'un autre jour : send-push en simulation, aucune écriture.
  appels.length = 0;
  const sim = await runPointConducteurs({ query: { simulation: "1", date: "2026-11-02" } }, baseJob(), { ...T_18H30, hour: 9 });
  assert.equal(appelsSendPush()[0].corps.simulation, true);
  assert.equal(sim.simulation, true);
  // Second créneau (19h30 l'été) : le point du jour est déjà en boîte → rien.
  appels.length = 0;
  const second = await runPointConducteurs({ query: { pas_avant: "18:30" } },
    baseJob({ notifications: [{ id: "n1", type: "C1", cle_regroupement: "C1-2026-11-02" }] }), { ...T_18H30, hour: 19 });
  assert.equal(second.skipped, "deja_envoye_aujourdhui");
  assert.equal(appelsSendPush().length, 0);
});

// ═══ 6. Branchements ═══════════════════════════════════════════════════════
test("18. dispatcher : ?job=point_conducteurs, aucune nouvelle fonction Vercel", () => {
  const disp = lire("api/cron-dispatcher.js");
  assert.match(disp, /require\("\.\/_cron\/cron-point-conducteurs\.js"\)/);
  assert.match(disp, /point_conducteurs: \{\s*fenetre: null,\s*run: \(req, supabase, t\) => runPointConducteurs\(req, supabase, t\)/);
  const { readdirSync } = require("node:fs");
  assert.ok(!readdirSync(chemin("api")).some((f) => /point/i.test(f)), "aucun fichier ajouté à la racine de api/");
});

test("19. créneau pg_cron : 18h30 Paris en été comme en hiver, jours ouvrés ; simulation par défaut sur GitHub", () => {
  const wf = lire(".github/workflows/cron-point-conducteurs.yml");
  // Créneau tenu par la base (pg_cron), plus par GitHub : deux passages UTC,
  // la commande n'appelle que si l'heure de Paris vaut 18h. Détail :
  // verif-cron-notifications.mjs.
  assert.ok(!/^\s*schedule:/m.test(wf), "plus de schedule GitHub");
  const migr = lire("supabase/migrations/20261109140000_cron_notifications_push.sql");
  assert.match(migr, /'profero_push_point_conducteurs',\s*'30 16,17 \* \* 1-5'/);
  assert.match(migr, /cron-dispatcher\?job=point_conducteurs&pas_avant=18:30'/);
  assert.match(migr, /<> 18 then\s*\n\s*return;/);
  const crons = ["30 16 * * 1-5", "30 17 * * 1-5"];
  assert.match(wf, /\?job=\$job"/);
  assert.match(wf, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*simulation:[\s\S]*?default: true/);
  // Heure de Paris de chaque créneau, été et hiver : exactement un passage à 18h30, aucun avant ignoré qui enverrait.
  const pasAvant = lirePasAvant("18:30");
  for (const [jour, saison] of [["2026-07-06", "été"], ["2026-11-09", "hiver"], ["2027-03-29", "été (lendemain du changement)"], ["2026-10-26", "hiver (lendemain du changement)"]]) {
    const heures = crons.map((c) => {
      const [mi, h] = c.split(" ").map(Number);
      const p = V.partiesParis(Date.parse(`${jour}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:00Z`));
      return p.heure * 60 + p.minute;
    });
    const envoient = heures.filter((m) => Math.floor(m / 60) === 18 && m >= pasAvant);
    assert.deepEqual(envoient, [18 * 60 + 30], `${saison} : un seul envoi, à 18h30`);
    assert.ok(heures.every((m) => m < 20 * 60), `${saison} : avant la plage de silence de 20h`);
  }
  const verif = lire(".github/workflows/verify-point-conducteurs.yml");
  assert.match(verif, /node scripts\/verif-point-conducteurs\.mjs/);
});

test("20. journal des MAJ : entrée en langage métier", () => {
  assert.match(lire("src/Renovation/journalMaj.js"), /Point du soir des conducteurs à 18h30 sur téléphone/);
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`✓ ${nom}`); }
  catch (e) { echecs++; console.error(`✗ ${nom}\n  ${e.stack || e.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies.`);
if (echecs) process.exit(1);
