#!/usr/bin/env node
// Vérifie le lot 4 de la Refonte Opérations (automatisation ProGBat) :
// src/Renovation/progbatAutomatisation.mjs (client → chantier ProGBat → devis,
// facture d'acompte, statut du devis) et ses branchements.
//
// AUCUN réseau, AUCUNE base : ProGBat est remplacé par un FAUX CLIENT HTTP qui
// fait ÉCHOUER le test si une écriture (POST) part sans confirmation explicite
// ou sans réservation préalable en base. Données fictives (jeu de test).
//   node scripts/verif-refonte-lot4.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (f) => readFileSync(join(racine, f), "utf8");
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const imp = (f) => import(new URL(`../${f}`, import.meta.url).href);

const A = await imp("src/Renovation/progbatAutomatisation.mjs");
const { verifierCopies } = await imp("scripts/sync-progbat-edge-lib.mjs");
let n = 0;
async function test(nom, fn) { await fn(); n++; console.log("ok -", nom); }

// ─── Jeu de test (données fictives) ─────────────────────────────────────────
const MAINTENANT = new Date("2026-11-06T10:00:00Z");
const PID = "11111111-2222-4333-8444-555555555555";
const BUREAU = { id: "u-bureau", email: "bureau@exemple.test", role: "bureau", actif: true };
const clientFictif = () => ({
  id: "c-1", type: "particulier", nom: "Testeur", prenom: "Alice", raison_sociale: "", contact_nom: "",
  adresse: "1 rue de l'Essai", adresse_complement: "", code_postal: "49000", ville: "Saint-Testville", pays: "France",
  email: "alice@exemple.test", telephone: "06 00 00 00 01", progbat_client_id: null,
});
const projetFictif = () => ({
  id: PID, logement_reference: "T2 - R+1", type_logement: "T2",
  chantier_adresse: "5 place du Test", chantier_code_postal: "49100", chantier_ville: "Angers", chantier_pays: "France",
  progbat_devis_id: null, progbat_client_id: null, progbat_business_id: null, progbat_yard_id: null,
});
const chantierFictif = () => ({ id: "ch-1", operation_id: "op-1", client_id: null, charge_affaires_id: "u-ca", progbat_business_id: null, progbat_yard_id: null });
const operationFictive = () => ({ id: "op-1", client_id: "c-1", charge_affaires_id: "u-ca" });
const TIERS = [
  { id: 501, code: "AUTRE NANTES", type: 2, legalName: "Autre Personne", addresses: [{ byDefault: true, address: "9 rue Ailleurs", postcode: "44000", city: "Nantes", email: "autre@exemple.test" }] },
  { id: 502, code: "TESTEUR ST TESTVILLE", type: 2, legalName: "TESTEUR Alice", addresses: [{ byDefault: true, address: "1 rue de l'Essai", postcode: "49000", city: "Saint-Testville", email: "alice@exemple.test", phone: "0600000001" }] },
];

function creerMonde({ client = clientFictif(), projet = projetFictif(), chantier = chantierFictif(), operation = operationFictive(), tiers = TIERS, reponses = {}, cycle = null, factures = [], billsProgbat = [], managers = {} } = {}) {
  const etat = { client, projet, chantier, operation, ecritures: [], appels: [], yards: [], projets: [projet], requete: null };
  const reserve = (cible, cle) => etat.ecritures.find((e) => e.cible === cible && e.cle === String(cle) && e.statut === "creating");
  // ── Faux client HTTP ProGBat : la garde est ICI ──
  const garde = (cible, cle) => {
    if (etat.requete?.confirmed !== true) throw new Error(`ÉCRITURE ${cible} PARTIE SANS CONFIRMATION`);
    if (!reserve(cible, cle)) throw new Error(`ÉCRITURE ${cible} PARTIE SANS RÉSERVATION`);
  };
  const progbat = {
    jetonPresent: true,
    async lireTiers(type) { etat.appels.push(`GET thirds?type=${type}`); return reponses.lireTiers || { ok: true, items: tiers.filter((t) => t.type === type) }; },
    async lireTiersUn(id) { etat.appels.push(`GET thirds/${id}`); const t = tiers.find((x) => x.id === id); return t ? { ok: true, status: 200, data: t } : { ok: false, status: 404, message: "" }; },
    async creerTiers(corps) { garde("client", etat.client.id); etat.appels.push("POST thirds"); etat.dernierCorps = corps; return reponses.creerTiers || { ok: true, status: 200, data: { id: 900, code: corps.code } }; },
    async creerAffaire(corps) { garde("chantier", etat.chantier.id); etat.appels.push("POST business"); etat.dernierCorps = corps; return reponses.creerAffaire || { ok: true, status: 201, data: { id: 300, code: corps.code } }; },
    async lireYards(id) { etat.appels.push(`GET business/${id}/yards`); return reponses.lireYards || { ok: true, items: [{ id: 410, businessId: id, label: "T2 - R+1" }] }; },
    async lireDevis(id) { etat.appels.push(`GET quotes/${id}`); return reponses.lireDevis || { ok: true, status: 200, data: { id, status: 1, statusDate: "2026-11-05" } }; },
    async facturesDuDevis(id) { etat.appels.push(`GET bills quote=${id}`); return reponses.facturesDuDevis || { ok: true, items: billsProgbat }; },
    async creerAcompte(qid, corps) { garde("acompte", qid); etat.appels.push(`POST quotes/${qid}/advance-bill`); etat.dernierCorps = corps; return reponses.creerAcompte || { ok: true, status: 201, data: { id: 700, code: "$000700" } }; },
  };
  const depot = {
    async chargerContexte(id) { return id === PID ? { projet: etat.projet, chantier: etat.chantier, operation: etat.operation, client: etat.client, projetsChantier: etat.projets } : null; },
    async dernieresEcritures(cles) {
      const out = {};
      for (const [cible, cle] of Object.entries(cles)) out[cible] = cle ? [...etat.ecritures].reverse().find((e) => e.cible === cible && e.cle === cle) || null : null;
      return out;
    },
    async lireManagers() { return managers; },
    async reserverEcriture(l) {
      etat.appels.push(`RESERVE ${l.cible}`);
      if (etat.ecritures.some((e) => e.cible === l.cible && e.cle === l.cle && ["creating", "created", "uncertain"].includes(e.statut))) return { ok: false, conflit: true };
      const id = `w${etat.ecritures.length + 1}`; etat.ecritures.push({ id, ...l }); return { ok: true, id };
    },
    async majEcriture(id, patch) { Object.assign(etat.ecritures.find((e) => e.id === id), patch); return { ok: true }; },
    async lierClient(id, tid) { etat.client.progbat_client_id = String(tid); return { ok: true }; },
    async lierChantier(id, { businessId, yardId, code }) { Object.assign(etat.chantier, { progbat_business_id: businessId, progbat_yard_id: yardId, progbat_business_code: code }); return { ok: true }; },
    async enregistrerYard(id, y) { etat.yards.push(y); return { ok: true }; },
    async majProjets(l) { l.forEach((x) => Object.assign(etat.projets.find((p) => p.id === x.id), x.patch)); return { ok: true }; },
    async majProjet(id, patch) { Object.assign(etat.projet, patch); return { ok: true }; },
    async cycleVieChantier() { return cycle || { lignes: [], meta: null }; },
    async facturesAcompteConnues() { return factures; },
  };
  const appeler = async (requete) => { etat.requete = requete; return A.traiterRequeteAutomatisation({ projectId: PID, ...requete }, { appelant: BUREAU, depot, progbat, maintenant: MAINTENANT }); };
  return { etat, appeler, depot, progbat };
}
const posts = (etat) => etat.appels.filter((a) => a.startsWith("POST"));

// ─── 1. Pureté ──────────────────────────────────────────────────────────────
await test("1. modules purs (ni Supabase, ni horloge, ni réseau) et façades .js", () => {
  for (const f of ["progbatAutomatisation", "progbatStatutDevis", "progbatDiagnosticLot4"]) {
    const s = sansCommentaires(lire(`src/Renovation/${f}.mjs`));
    assert.ok(!/supabase/i.test(s), `${f} : aucun accès Supabase`);
    assert.ok(!/Date\.now\s*\(|new Date\(\s*\)/.test(s), `${f} : aucune horloge`);
    assert.ok(!/\bfetch\s*\(|\.from\s*\(\s*["']|\.rpc\s*\(/.test(s), `${f} : aucun réseau ni base`);
  }
  assert.match(lire("src/Renovation/progbatAutomatisation.js"), /export \* from "\.\/progbatAutomatisation\.mjs"/);
  assert.ok(!/^import /m.test(lire("src/Renovation/progbatStatutDevis.mjs")), "statut du devis : module sans import (copié seul dans la tâche planifiée)");
});

// ─── 2. Valeurs relevées en lecture ─────────────────────────────────────────
await test("2. valeurs ProGBat relevées en lecture : client = type 2, particulier = legalType 1, statuts du devis", () => {
  assert.equal(A.TYPE_TIERS.client, 2);
  assert.equal(A.TYPE_TIERS.prospect, 4);
  assert.equal(A.LEGAL_TYPE.particulier, 1);
  assert.equal(A.LEGAL_TYPE.societe, 0);
  assert.equal(A.interpreterStatutDevis(0).code, "etude");
  assert.equal(A.interpreterStatutDevis(1).code, "accepte");
  assert.equal(A.interpreterStatutDevis(2).code, "refuse");
  assert.equal(A.interpreterStatutDevis(6).code, "attente");
  assert.equal(A.interpreterStatutDevis(9).code, "inconnu");
  assert.deepEqual(A.construireCorpsAcompte(), { advanceRate: 50 });
  assert.equal(A.codePays("France"), "FR");
  assert.equal(A.codePays(""), "FR");
  assert.equal(A.codePays("Atlantide"), null);
});

// ─── 3. Corps des écritures ─────────────────────────────────────────────────
await test("3. corps du client (POST /company/thirds) et du chantier (POST /company/business)", () => {
  const c = A.construireCorpsClient(clientFictif());
  assert.ok(c.ok, c.erreurs.join(";"));
  assert.equal(c.corps.type, 2);
  assert.equal(c.corps.legalType, 1);
  assert.equal(c.corps.code, "TESTEUR ST TESTVILLE");
  assert.equal(c.corps.legalName, "Testeur Alice");
  assert.equal(c.corps.address.country, "FR");
  for (const k of ["label", "address", "postcode", "city", "country"]) assert.ok(c.corps.address[k], `address.${k} obligatoire`);
  const soc = A.construireCorpsClient({ ...clientFictif(), type: "societe", raison_sociale: "SCI Essai", contact_nom: "M. Contact", nom: "", prenom: "" });
  assert.equal(soc.corps.legalType, 0);
  assert.equal(soc.corps.businessName, "SCI Essai");
  assert.equal(soc.corps.contact.lastname, "M. Contact");
  const inc = A.construireCorpsClient({ ...clientFictif(), email: "" });
  assert.equal(inc.ok, false);

  const b = A.construireCorpsChantier({ thirdId: 900, projet: projetFictif(), client: clientFictif(), clientAffichage: "Testeur Alice", managerId: null });
  assert.ok(b.ok, b.erreurs.join(";"));
  for (const k of ["code", "label", "thirdId", "address", "postcode", "city"]) assert.ok(b.corps[k], `${k} obligatoire`);
  assert.equal(b.corps.country, "FR");
  assert.equal(b.corps.code, "TESTEUR ST TESTVILLE T2 R+1");
  assert.equal(b.corps.label, "Testeur Alice — T2 - R+1");
  assert.ok(!("managerId" in b.corps), "sans correspondance : pas de managerId");
  assert.equal(b.sans_responsable, true);
  assert.equal(A.construireCorpsChantier({ thirdId: 900, projet: projetFictif(), client: clientFictif(), clientAffichage: "x", managerId: 15 }).corps.managerId, 15);
  assert.equal(A.construireCorpsChantier({ thirdId: null, projet: projetFictif(), client: clientFictif() }).ok, false);
});

// ─── 4. Correspondances : propositions seulement ────────────────────────────
await test("4. recherche du client : propositions avec raisons, jamais de rattachement automatique", async () => {
  const m = A.chercherCorrespondances(clientFictif(), TIERS);
  assert.equal(m.length, 1);
  assert.equal(m[0].id, 502);
  assert.ok(m[0].raisons.includes("même e-mail"));
  assert.ok(m[0].raisons.includes("même téléphone"));
  assert.ok(m[0].raisons.some((r) => /identifiant/.test(r)));
  const w = creerMonde();
  const r = await w.appeler({ action: "chercher_clients" });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.correspondances.length, 1);
  assert.equal(w.etat.client.progbat_client_id, null, "la recherche ne rattache rien");
  assert.equal(posts(w.etat).length, 0);
  // Rattachement : seulement sur choix confirmé
  const sans = await w.appeler({ action: "lier_client", thirdId: 502 });
  assert.equal(sans.body.code, "confirmation_requise");
  assert.equal(w.etat.client.progbat_client_id, null);
  const avec = await w.appeler({ action: "lier_client", thirdId: 502, confirmed: true });
  assert.equal(avec.body.ok, true);
  assert.equal(w.etat.client.progbat_client_id, "502");
  assert.equal(w.etat.projets[0].progbat_client_id, "502", "reporté sur le chiffrage sans devis");
  assert.equal(posts(w.etat).length, 0, "relier un client existant n'écrit rien dans ProGBat");
});

// ─── 5. Création du client : confirmation + empreinte + choix explicite + réservation ──
await test("5. création du client : refus sans confirmation, sans aperçu à jour, sans correspondances écartées ; puis une seule écriture", async () => {
  const w = creerMonde();
  const prep = await w.appeler({ action: "preparer_client" });
  assert.equal(prep.body.ok, true);
  assert.equal(posts(w.etat).length, 0, "l'aperçu n'écrit rien");
  assert.equal((await w.appeler({ action: "creer_client", expectedHash: prep.body.hash })).body.code, "confirmation_requise");
  assert.equal((await w.appeler({ action: "creer_client", confirmed: true, expectedHash: "faux" })).body.code, "hash_different");
  const nonVues = await w.appeler({ action: "creer_client", confirmed: true, expectedHash: prep.body.hash });
  assert.equal(nonVues.body.code, "correspondances_non_examinees");
  assert.equal(posts(w.etat).length, 0);
  assert.equal(w.etat.ecritures.length, 0, "aucune réservation avant le choix explicite");
  const ok = await w.appeler({ action: "creer_client", confirmed: true, expectedHash: prep.body.hash, correspondancesEcartees: [502] });
  assert.equal(ok.body.ok, true, ok.body.error);
  assert.equal(ok.body.thirdId, 900);
  assert.deepEqual(posts(w.etat), ["POST thirds"]);
  const iRes = w.etat.appels.indexOf("RESERVE client"), iPost = w.etat.appels.indexOf("POST thirds");
  assert.ok(iRes >= 0 && iRes < iPost, "réservation AVANT l'écriture");
  assert.equal(w.etat.client.progbat_client_id, "900");
  assert.equal(w.etat.ecritures[0].statut, "created");
  const encore = await w.appeler({ action: "creer_client", confirmed: true, expectedHash: prep.body.hash, correspondancesEcartees: [502] });
  assert.equal(encore.body.code, "deja_lie");
  assert.equal(posts(w.etat).length, 1, "rejeu sûr : jamais de second POST");
});

// ─── 6. Échecs : 403 affiché tel quel, incertain bloquant ───────────────────
await test("6. 403 → « droit ProGBat manquant : thirds.write » ; délai dépassé → incertain, tout nouvel essai bloqué", async () => {
  const w = creerMonde({ tiers: [], reponses: { creerTiers: { ok: false, status: 403, message: "Your application does not have the neccessary scopes to access this route" } } });
  const prep = await w.appeler({ action: "preparer_client" });
  const r = await w.appeler({ action: "creer_client", confirmed: true, expectedHash: prep.body.hash });
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /Droit ProGBat manquant : thirds\.write/);
  assert.match(r.body.a_faire_par_loris, /thirds\.write/);
  assert.equal(w.etat.ecritures[0].statut, "failed");
  // Un refus certain n'est pas bloquant : nouvel essai possible (nouvelle réservation)
  const w2 = creerMonde({ tiers: [], reponses: { creerTiers: { ok: false, status: 0, message: "délai", timeout: true } } });
  const p2 = await w2.appeler({ action: "preparer_client" });
  const r2 = await w2.appeler({ action: "creer_client", confirmed: true, expectedHash: p2.body.hash });
  assert.equal(r2.body.code, "etat_incertain");
  const r3 = await w2.appeler({ action: "creer_client", confirmed: true, expectedHash: p2.body.hash });
  assert.equal(r3.body.code, "etat_incertain");
  assert.equal(posts(w2.etat).length, 1, "incertain : aucun second POST");
  const lever = await w2.appeler({ action: "verifier_ecriture", cible: "client", confirmed: true });
  assert.equal(lever.body.ok, true);
  assert.equal(w2.etat.ecritures[0].statut, "failed");
  // Réservation concurrente refusée par la base → rien ne part
  const w3 = creerMonde({ tiers: [] });
  w3.etat.ecritures.push({ id: "x", cible: "client", cle: "c-1", statut: "creating", started_at: MAINTENANT.toISOString() });
  const p3 = await w3.appeler({ action: "preparer_client" });
  assert.ok(p3.body.blocage, "l'aperçu signale la création en cours");
  const r4 = await w3.appeler({ action: "creer_client", confirmed: true, expectedHash: p3.body.hash });
  assert.equal(r4.body.code, "creation_en_cours");
  assert.equal(posts(w3.etat).length, 0);
  assert.equal(A.classerResultat({ ok: false, status: 502 }), "uncertain");
  assert.equal(A.classerResultat({ ok: true, status: 201, data: {} }), "uncertain");
  assert.equal(A.classerResultat({ ok: false, status: 422 }), "failed");
});

// ─── 7. Chantier ProGBat : yard renvoyé ou relu ─────────────────────────────
await test("7. chantier ProGBat : client d'abord, yard dans la réponse ou relu, report sur le chiffrage", async () => {
  const w0 = creerMonde();
  const p0 = await w0.appeler({ action: "preparer_chantier" });
  assert.equal(p0.body.erreurs.length > 0, true, "sans client ProGBat : impossible");
  const c = clientFictif(); c.progbat_client_id = "502";
  const w = creerMonde({ client: c, managers: { "u-ca": 15 } });
  const prep = await w.appeler({ action: "preparer_chantier" });
  assert.equal(prep.body.corps.managerId, 15);
  assert.equal(prep.body.corps.thirdId, 502);
  assert.equal((await w.appeler({ action: "creer_chantier", expectedHash: prep.body.hash })).body.code, "confirmation_requise");
  const r = await w.appeler({ action: "creer_chantier", confirmed: true, expectedHash: prep.body.hash });
  assert.equal(r.body.ok, true, r.body.error);
  assert.equal(r.body.businessId, 300);
  assert.equal(r.body.yardId, 410, "yard absent de la réponse : relu");
  assert.ok(w.etat.appels.includes("GET business/300/yards"));
  assert.equal(w.etat.chantier.progbat_business_id, 300);
  assert.equal(w.etat.yards[0].yardId, 410, "alimente chantier_progbat_yards");
  assert.deepEqual([w.etat.projets[0].progbat_client_id, w.etat.projets[0].progbat_business_id, w.etat.projets[0].progbat_yard_id], ["502", "300", "410"]);
  // Yard renvoyé directement
  const w2 = creerMonde({ client: c, reponses: { creerAffaire: { ok: true, status: 201, data: { id: 301, yards: [{ id: 411, label: "T2 - R+1" }] } } } });
  const p2 = await w2.appeler({ action: "preparer_chantier" });
  assert.ok(p2.body.info, "sans correspondance : l'écran dit « sans responsable »");
  const r2 = await w2.appeler({ action: "creer_chantier", confirmed: true, expectedHash: p2.body.hash });
  assert.equal(r2.body.yardId, 411);
  assert.ok(!w2.etat.appels.includes("GET business/301/yards"));
  // Yard introuvable : chantier noté, alerte + relecture
  const w3 = creerMonde({ client: c, reponses: { lireYards: { ok: true, items: [] } } });
  const p3 = await w3.appeler({ action: "preparer_chantier" });
  const r3 = await w3.appeler({ action: "creer_chantier", confirmed: true, expectedHash: p3.body.hash });
  assert.equal(r3.body.yardId, null);
  assert.ok(r3.body.yard_raison);
  assert.ok(r3.body.etapes.chantier.alerte);
  assert.equal(A.decisionDevis(r3.body.etapes).autorise, false, "pas de devis sans yard");
  // 403 → droit business.write affiché, contournement proposé pour le devis
  const w4 = creerMonde({ client: c, reponses: { creerAffaire: { ok: false, status: 403, message: "" } } });
  const p4 = await w4.appeler({ action: "preparer_chantier" });
  const r4 = await w4.appeler({ action: "creer_chantier", confirmed: true, expectedHash: p4.body.hash });
  assert.match(r4.body.error, /Droit ProGBat manquant : business\.write/);
  const d = A.decisionDevis(r4.body.etapes);
  assert.equal(d.autorise, false);
  assert.equal(d.contournement, true);
  assert.deepEqual(d.droits_manquants, ["business.write"]);
});

// ─── 8. Facture d'acompte ───────────────────────────────────────────────────
await test("8. facture d'acompte : signature validée, aucune facture d'acompte existante, lecture des factures possible, puis une seule écriture", async () => {
  const projet = { ...projetFictif(), progbat_devis_id: "524" };
  const nonSigne = creerMonde({ projet });
  assert.equal((await nonSigne.appeler({ action: "preparer_acompte" })).body.code, "devis_non_signe");
  const signe = { lignes: [{ chantier_id: "ch-1", etape_id: "devis_signe", etat: { fait: true, date: "2026-11-05" } }], meta: null };
  // ancienne coche reprise (phasage) : vaut signature
  const ancien = creerMonde({ projet, cycle: { lignes: [], meta: { cycle_vie_etapes: { devis_signe: { fait: true } } } } });
  assert.equal((await ancien.appeler({ action: "preparer_acompte" })).body.ok, true);
  const deja = creerMonde({ projet: { ...projet }, cycle: signe, billsProgbat: [{ id: 77, quoteId: 524, type: "advance", code: "F-260077" }] });
  const pd = await deja.appeler({ action: "preparer_acompte" });
  assert.match(pd.body.deja_existante, /F-260077/);
  assert.equal((await deja.appeler({ action: "creer_acompte", confirmed: true, expectedHash: pd.body.hash })).body.code, "acompte_existant");
  const illisible = creerMonde({ projet: { ...projet }, cycle: signe, reponses: { facturesDuDevis: { ok: false, status: 403 } } });
  const pi = await illisible.appeler({ action: "preparer_acompte" });
  assert.equal((await illisible.appeler({ action: "creer_acompte", confirmed: true, expectedHash: pi.body.hash })).body.code, "verification_impossible");
  const w = creerMonde({ projet: { ...projet }, cycle: signe });
  const p = await w.appeler({ action: "preparer_acompte" });
  assert.equal(p.body.quoteId, 524);
  assert.equal((await w.appeler({ action: "creer_acompte", expectedHash: p.body.hash })).body.code, "confirmation_requise");
  const r = await w.appeler({ action: "creer_acompte", confirmed: true, expectedHash: p.body.hash });
  assert.equal(r.body.ok, true, r.body.error);
  assert.deepEqual(posts(w.etat), ["POST quotes/524/advance-bill"]);
  assert.deepEqual(w.etat.dernierCorps, { advanceRate: 50 });
  assert.equal(w.etat.projet.progbat_acompte_bill_id, "700");
  const encore = await w.appeler({ action: "creer_acompte", confirmed: true, expectedHash: p.body.hash });
  assert.equal(encore.body.ok, false);
  assert.equal(posts(w.etat).length, 1);
  for (const x of [nonSigne, ancien, deja, illisible]) assert.equal(posts(x.etat).length, 0);
  const w403 = creerMonde({ projet: { ...projet }, cycle: signe, reponses: { creerAcompte: { ok: false, status: 403 } } });
  const p403 = await w403.appeler({ action: "preparer_acompte" });
  assert.match((await w403.appeler({ action: "creer_acompte", confirmed: true, expectedHash: p403.body.hash })).body.error, /Droit ProGBat manquant : bills\.write/);
});

// ─── 9. Statut du devis : tâche planifiée et décisions ──────────────────────
await test("9. statut du devis : lecture seule, accepté → importer le devis signé, refusé → Marquer perdu", async () => {
  const appels = [];
  const majs = [];
  const rapport = await A.synchroniserStatutsDevis({
    maintenant: MAINTENANT,
    depot: { async devisASuivre() { return [{ id: "p1", progbat_devis_id: "524", progbat_devis_statut: 0 }, { id: "p2", progbat_devis_id: "525", progbat_devis_statut: null }, { id: "p3", progbat_devis_id: null }]; }, async majProjet(id, patch) { majs.push([id, patch]); return { ok: true }; } },
    progbat: { async lireDevis(q) { appels.push(q); return { ok: true, data: { status: q === 524 ? 1 : 2, statusDate: "2026-11-05" } }; } },
  });
  assert.deepEqual(appels, [524, 525]);
  assert.equal(rapport.acceptes, 1);
  assert.equal(rapport.refuses, 1);
  assert.equal(majs[0][1].progbat_devis_statut, 1);
  assert.equal(A.decisionStatutDevis({ statut: 1, devisSigneFait: false }).action, "importer_signe");
  assert.match(A.decisionStatutDevis({ statut: 1, devisSigneFait: false }).message, /devis accepté dans ProGBat : importer le devis signé/i);
  assert.equal(A.decisionStatutDevis({ statut: 1, devisSigneFait: true }).action, null);
  assert.equal(A.decisionStatutDevis({ statut: 2 }).action, "marquer_perdu");
  assert.equal(A.decisionStatutDevis({ statut: 2, perdu: true }).action, null);
  assert.equal(A.interpreterStatutDevis(A.STATUT_INTROUVABLE).code, "introuvable");
  assert.match(A.decisionStatutDevis({ statut: -1 }).message, /introuvable dans ProGBat/, "devis supprimé : dit, pas « pas encore lu »");
  const majs404 = [];
  const r404 = await A.synchroniserStatutsDevis({ maintenant: MAINTENANT, depot: { async devisASuivre() { return [{ id: "p9", progbat_devis_id: "473" }]; }, async majProjet(id, patch) { majs404.push(patch); return { ok: true }; } }, progbat: { async lireDevis() { return { ok: false, status: 404 }; } } });
  assert.equal(r404.introuvables, 1);
  assert.equal(r404.erreurs, 0);
  assert.equal(majs404[0].progbat_devis_statut, -1);
  assert.match(A.decisionStatutDevis({ statut: null }).message, /pas encore lu/, "statut jamais lu : dit, pas présenté comme un résultat");
  const src = sansCommentaires(lire("supabase/functions/progbat-devis-statut-cron/index.ts"));
  assert.ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(src), "la tâche planifiée ne fait que des GET vers ProGBat");
  assert.match(src, /method:\s*"GET"/);
});

// ─── 10. Report des identifiants : jamais sur un devis déjà créé ────────────
await test("10. report sur les chiffrages : uniquement ceux sans devis", () => {
  const r = A.reportProjets([{ id: "a", progbat_devis_id: "524" }, { id: "b", progbat_devis_id: null }, { id: "c", progbat_client_id: "9" }], { thirdId: 9, businessId: 3, yardId: 4 });
  assert.deepEqual(r.map((x) => x.id), ["b", "c"]);
  assert.deepEqual(r[1].patch, { progbat_business_id: "3", progbat_yard_id: "4" });
});

// ─── 11. Edge Function : seules trois écritures, toutes via la logique pure ─
await test("11. progbat-operations : trois POST seulement (thirds, business, advance-bill), aucun PUT/DELETE", () => {
  const src = sansCommentaires(lire("supabase/functions/progbat-operations/index.ts"));
  const postes = [...src.matchAll(/appel\("POST",\s*([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(postes, ['"/company/thirds"', '"/company/business"', "`/company/quotes/${encodeURIComponent(String(quoteId))}/advance-bill`"]);
  assert.ok(!/"(PUT|PATCH|DELETE)"/.test(src), "aucun PUT / PATCH / DELETE");
  assert.match(src, /traiterRequeteAutomatisation\(/);
  const copies = verifierCopies();
  assert.deepEqual(copies, [], `copies serveur à jour (${copies.join(", ")})`);
});

// ─── 12. Migration additive ─────────────────────────────────────────────────
await test("12. migration du lot 4 purement additive, policy profero_collaborateurs_seulement sur la nouvelle table", () => {
  const nom = readdirSync(join(racine, "supabase/migrations")).find((f) => /refonte_operations_lot4\.sql$/.test(f));
  assert.ok(nom, "migration versionnée");
  const sql = sansCommentaires(lire(`supabase/migrations/${nom}`)).replace(/--.*$/gm, "").toLowerCase();
  for (const motif of [/\bdrop\b/, /\bdelete\s+from\b/, /\btruncate\b/, /\bupdate\s+public\./, /\brename\b/, /security\s+definer/]) assert.ok(!motif.test(sql), `interdit : ${motif}`);
  assert.match(sql, /create table public\.progbat_ecritures/);
  assert.match(sql, /create policy profero_collaborateurs_seulement on public\.progbat_ecritures\s+as restrictive/);
  assert.match(sql, /create unique index progbat_ecritures_actif_uidx/);
  assert.ok(!/create policy (?!profero_collaborateurs_seulement)/.test(sql), "aucune autre policy");
  assert.ok(lire("sql/202611_refonte_operations_lot4_rollback.sql").includes("progbat_ecritures_sauvegarde_refonte"));
});

// ─── 13. Écrans ─────────────────────────────────────────────────────────────
await test("13. écrans : panneau client/chantier avant le devis, acompte sur « Devis signé », réglage des responsables, journal", () => {
  const apercu = lire("src/Renovation/ProgbatApercuDevis.jsx");
  assert.match(apercu, /<ProgbatClientChantier/);
  assert.match(apercu, /decisionDevis\(/);
  const page = sansCommentaires(lire("src/Renovation/PageChantiers.jsx"));
  assert.match(page, /<AcompteProgbat/);
  assert.match(page, /decisionStatutDevis\(/);
  assert.ok(!/création automatique à venir \(lot 4\)/.test(page), "texte d'attente du lot 3 remplacé");
  assert.match(lire("src/Renovation/Admin.jsx"), /<ProgbatManagersAdmin/);
  for (const f of ["ProgbatClientChantier.jsx", "AcompteProgbat.jsx", "ProgbatManagersAdmin.jsx"]) {
    const s = sansCommentaires(lire(`src/Renovation/${f}`));
    assert.ok(!s.includes("app.progbat.com"), `${f} : liens via progbatLiens`);
    assert.ok(!/api\.progbat\.com/.test(s), `${f} : jamais d'appel direct à l'API ProGBat`);
  }
  assert.match(lire("src/Renovation/journalMaj.js"), /le client et le chantier se créent depuis le chiffrage/);
});

// ─── 14. Clients ProGBat existants (demande de Loris du 06/11) ──────────────
await test("14. client ProGBat existant : liste en lecture, fiche locale pré-remplie, réutilisée, jamais deux fois, aucune écriture ProGBat", async () => {
  const brut = { id: 174, code: "DUPONT ANGERS", type: 2, legalType: 1, legalName: "Mr et Mme DUPONT", addresses: [{ byDefault: true, address: "3 rue Fictive", postcode: "49000", city: "Angers", country: "FR" }], contacts: [] };
  const { fiche, manquants } = A.ficheDepuisTiers(brut);
  assert.equal(fiche.type, "particulier");
  assert.equal(fiche.nom, "Mr et Mme DUPONT", "nom repris tel quel, rien n'est deviné");
  assert.equal(fiche.pays, "France");
  assert.equal(fiche.code_progbat, "DUPONT ANGERS", "identifiant ProGBat repris, pas regénéré");
  assert.equal(fiche.progbat_client_id, "174");
  // Demande de Loris du 07/11 : client relié à ProGBat → les règles Profero
  // (prénom, e-mail, téléphone) ne bloquent pas ; ce qui manque dans ProGBat
  // reste visible en note (« Absent dans ProGBat : … »).
  assert.deepEqual(manquants, [], "client ProGBat existant : rien de bloquant");
  const notes = A.ficheDepuisTiers(brut).notes.map((m) => m.champ);
  assert.ok(notes.includes("email") && notes.includes("telephone") && notes.includes("prenom"), "ce que ProGBat n'a pas est listé en note");
  assert.equal(A.ficheDepuisTiers({ ...brut, legalType: 0, businessName: "SCI Fictive", contacts: [{ lastname: "M. Contact" }] }).fiche.raison_sociale, "SCI Fictive");
  const locaux = [];
  let creations = 0;
  const appels = [];
  const progbat = {
    async lireTiers(type) { appels.push(`GET ${type}`); return { ok: true, items: type === 2 ? [brut] : [] }; },
    async lireTiersUn(id) { appels.push(`GET ${id}`); return id === 174 ? { ok: true, data: brut } : { ok: false, status: 404 }; },
    async creerTiers() { throw new Error("ÉCRITURE ProGBat INTERDITE ICI"); },
  };
  const depot = {
    async clientParProgbatId(id) { return locaux.find((c) => c.progbat_client_id === String(id)) || null; },
    async creerClientLocal(f) { if (locaux.some((c) => c.progbat_client_id === f.progbat_client_id)) return { ok: false, conflit: true }; creations++; const c = { id: `loc-${creations}`, ...f }; locaux.push(c); return { ok: true, client: c }; },
    async completerClient(id, patch) { const c = locaux.find((x) => x.id === id); Object.assign(c, patch); return { ok: true, client: { ...c } }; },
  };
  const ctx = { appelant: BUREAU, depot, progbat, maintenant: MAINTENANT };
  const liste = await A.traiterRequeteAutomatisation({ action: "lister_clients_progbat" }, ctx);
  assert.equal(liste.body.ok, true);
  assert.equal(liste.body.clients[0].id, 174);
  assert.equal((await A.traiterRequeteAutomatisation({ action: "importer_client_progbat", thirdId: 174 }, ctx)).body.code, "confirmation_requise");
  const r1 = await A.traiterRequeteAutomatisation({ action: "importer_client_progbat", thirdId: 174, confirmed: true }, ctx);
  assert.equal(r1.body.ok, true);
  assert.equal(r1.body.reutilise, false);
  assert.equal(r1.body.manquants.length, 0, "plus de bandeau « fiche incomplète » pour un client ProGBat");
  assert.ok(r1.body.notes.length > 0, "les absences ProGBat sont rendues, en note");
  const r2 = await A.traiterRequeteAutomatisation({ action: "importer_client_progbat", thirdId: 174, confirmed: true }, ctx);
  assert.equal(r2.body.reutilise, true, "même client ProGBat : la fiche locale est réutilisée");
  assert.equal(creations, 1);
  assert.ok(appels.every((a) => a.startsWith("GET")));
  // Un nouveau client qui ressemble : proposé, jamais rattaché tout seul
  const m = A.chercherCorrespondances({ type: "particulier", nom: "Dupont", prenom: "Jean", ville: "Angers" }, liste.body.clients);
  assert.equal(m.length, 1);
  assert.match(m[0].raisons.join(), /nom de famille/);
  // Client déjà relié : l'étape client est faite, aucune création au moment du devis
  const c = clientFictif(); c.progbat_client_id = "174";
  const w = creerMonde({ client: c });
  const e = await w.appeler({ action: "etat" });
  assert.equal(e.body.etapes.client.fait, true);
  assert.equal((await w.appeler({ action: "creer_client", confirmed: true, expectedHash: "x" })).body.code, "deja_lie");
  assert.equal(posts(w.etat).length, 0);
  const sql = lire(`supabase/migrations/${readdirSync(join(racine, "supabase/migrations")).find((f) => /refonte_operations_lot4\.sql$/.test(f))}`);
  assert.match(sql, /create unique index clients_progbat_client_id_uidx on public\.clients \(progbat_client_id\)/);
  const op = lire("src/Renovation/OperationCommercial.jsx");
  assert.match(op, /<ChoixClientProgbatModal/);
  assert.match(op, /onProgbat=/);
  assert.match(lire("src/Renovation/ComposantsCommerciaux.jsx"), /<RessemblancesProgbat/);
});

// ─── 15. Client ProGBat existant : reprise complète (demande de Loris du 07/11) ──
// Jeu de test, données fictives. Forme d'un tiers relevée en LECTURE le 07/11
// (GET /company/thirds/{id}) : legalType, legalName, businessName, civility,
// addresses[] (address, address2, postcode, city, country, email, phone,
// mobile), contacts[] (lastname, email, phone, mobile) ; aucun champ prénom.
const NP = await imp("src/Renovation/progbatNomPrenom.mjs");
const R = await imp("src/Renovation/reglesSaisieProgbat.mjs");
await test("15a. découpage nom / prénom : « NOM Prénom » ou « Prénom NOM » seulement, sinon nom entier", async () => {
  const d = NP.decouperNomPrenom;
  assert.deepEqual([d("TESTEUR Alice").nom, d("TESTEUR Alice").prenom], ["TESTEUR", "Alice"]);
  assert.deepEqual([d("Jean-Pierre ESSAI").nom, d("Jean-Pierre ESSAI").prenom], ["ESSAI", "Jean-Pierre"]);
  assert.deepEqual([d("DE LA FICTION Élodie").nom, d("DE LA FICTION Élodie").prenom], ["DE LA FICTION", "Élodie"]);
  assert.deepEqual([d("D'ESSAI Marc").nom, d("D'ESSAI Marc").prenom], ["D'ESSAI", "Marc"]);
  for (const ambigu of ["TESTEUR ALICE", "Testeur Alice", "Mr et Mme TESTEUR", "M. TESTEUR", "TESTEUR", "TESTEUR Alice ESSAI", "TESTEUR & Alice", "de TESTEUR Alice", "TESTEUR 2", ""]) {
    const r = d(ambigu);
    assert.equal(r.decoupe, false, `« ${ambigu} » est ambigu`);
    assert.equal(r.prenom, "", `« ${ambigu} » : aucun prénom inventé`);
    assert.equal(r.nom, ambigu.replace(/\s+/g, " ").trim(), `« ${ambigu} » : nom laissé entier`);
  }
});

await test("15b. fiche remplie depuis ProGBat : type, nom, prénom, adresse, e-mail et téléphone (adresse ou contact)", async () => {
  const part = { id: 151, code: "TESTEUR ANGERS", type: 2, legalType: 1, legalName: "TESTEUR Alice", civility: "Mme",
    addresses: [{ byDefault: false, address: "9 rue Secondaire", postcode: "44000", city: "Nantes", country: "FR", email: "", phone: "", mobile: "06 00 00 00 09" },
      { byDefault: true, address: "1 rue Fictive", address2: "Bât. B", postcode: "49000", city: "Angers", country: "FR", email: "", phone: "", mobile: "" }],
    contacts: [{ byDefault: true, lastname: "TESTEUR Alice", email: "alice@exemple.test", phone: "", mobile: "" }] };
  const { fiche, manquants, notes } = A.ficheDepuisTiers(part);
  assert.equal(fiche.type, "particulier");
  assert.equal(fiche.nom, "TESTEUR");
  assert.equal(fiche.prenom, "Alice");
  assert.equal(fiche.adresse, "1 rue Fictive", "adresse par défaut d'abord");
  assert.equal(fiche.adresse_complement, "Bât. B");
  assert.equal(fiche.ville, "Angers");
  assert.equal(fiche.pays, "France");
  assert.equal(fiche.email, "alice@exemple.test", "e-mail du contact quand l'adresse n'en a pas");
  assert.equal(fiche.telephone, "06 00 00 00 09", "téléphone d'une autre adresse en repli");
  assert.deepEqual(manquants, []);
  assert.deepEqual(notes, []);
  // Société : raison sociale (businessName), contact
  const soc = A.ficheDepuisTiers({ id: 152, type: 2, legalType: 0, legalName: "SCI FICTIVE", businessName: "SCI Fictive", addresses: [{ byDefault: true, address: "2 rue Essai", postcode: "49100", city: "Angers", country: "FR", email: "sci@exemple.test", phone: "02 00 00 00 00" }], contacts: [{ byDefault: true, lastname: "M. Contact" }] });
  assert.equal(soc.fiche.type, "societe");
  assert.equal(soc.fiche.raison_sociale, "SCI Fictive");
  assert.equal(soc.fiche.contact_nom, "M. Contact");
  assert.equal(soc.fiche.telephone, "02 00 00 00 00");
  // Nom ambigu : entier, prénom vide, et ça ne bloque pas
  const amb = A.ficheDepuisTiers({ id: 153, type: 2, legalType: 1, legalName: "TESTEUR", addresses: [{ byDefault: true, address: "3 rue Essai", postcode: "49000", city: "Angers", country: "FR" }], contacts: [] });
  assert.equal(amb.fiche.nom, "TESTEUR");
  assert.equal(amb.fiche.prenom, "");
  assert.deepEqual(amb.manquants, []);
  assert.deepEqual(amb.notes.map((x) => x.court), ["prénom", "e-mail", "téléphone"]);
  // Repli sur le contact : nom ProGBat « TESTEUR » + contact « TESTEUR Alice »
  assert.equal(A.ficheDepuisTiers({ id: 154, type: 2, legalType: 1, legalName: "TESTEUR", addresses: [], contacts: [{ byDefault: true, lastname: "TESTEUR Alice" }] }).fiche.prenom, "Alice");
  // … mais jamais un prénom pris chez un contact d'un AUTRE nom
  assert.equal(A.ficheDepuisTiers({ id: 155, type: 2, legalType: 1, legalName: "TESTEUR", addresses: [], contacts: [{ byDefault: true, lastname: "AUTRE Paul" }] }).fiche.prenom, "");
});

await test("15c. une seule liste de règles : prénom / e-mail / téléphone bloquent un NOUVEAU client, pas un client ProGBat", async () => {
  const nouveau = { type: "particulier", nom: "Testeur", prenom: "", adresse: "1 rue", code_postal: "49000", ville: "Angers", pays: "France", email: "", telephone: "" };
  const ids = (l) => l.map((m) => m.id).sort();
  assert.deepEqual(ids(R.controlerFiche("client", nouveau)), ["client_email", "client_prenom", "client_telephone"], "nouveau client : règles Profero bloquantes (lot 2)");
  assert.deepEqual(R.notesFiche("client", nouveau), [], "nouveau client : pas de note, c'est une erreur");
  const relie = { ...nouveau, progbat_client_id: "151" };
  assert.deepEqual(R.controlerFiche("client", relie), [], "client ProGBat : rien de bloquant");
  assert.equal(R.noteAbsentsProgbat(relie), "Absent dans ProGBat : prénom, e-mail, téléphone");
  assert.equal(R.estObligatoire("client", "email", nouveau), true);
  assert.equal(R.estObligatoire("client", "email", relie), false, "pas d'astérisque pour un client ProGBat");
  // L'adresse reste exigée (ProGBat l'a pour tous ses clients relevés)
  assert.deepEqual(ids(R.controlerFiche("client", { ...relie, adresse: "" })), ["client_adresse"]);
  // Les règles Profero sont marquées dans la liste unique, pas ailleurs
  assert.deepEqual(R.REGLES_SAISIE.filter((r) => r.profero).map((r) => r.id), ["client_prenom", "client_email", "client_telephone"]);
  // Avant-envoi (construireEnTeteDevis lit la même liste) : chiffrage sans thirdId → règles Profero ; client du projet relié → aucune
  const P = await imp("src/Renovation/progbatQuotePayload.mjs");
  const src = sansCommentaires(lire("src/Renovation/progbatQuotePayload.mjs"));
  assert.match(src, /controlerFiche\("client", clientDepuisProjet\(projet\)/, "l'avant-envoi lit la liste unique");
  assert.equal(R.clientDepuisProjet({ client_nom: "X", progbat_client_id: "151" }).progbat_client_id, "151");
  assert.ok(P, "module d'avant-envoi chargé");
  // L'écran n'a pas de contournement : le bandeau lit controlerFiche, la note lit noteAbsentsProgbat
  const ecran = sansCommentaires(lire("src/Renovation/OperationCommercial.jsx"));
  assert.match(ecran, /controlerFiche\("client", cl\)/);
  assert.ok(!/profero|progbat_client_id/.test(ecran.match(/const manquantsFiche[^\n]*/)[0]), "aucun filtre à l'écran");
  assert.match(sansCommentaires(lire("src/Renovation/ClientsProgbat.jsx")), /noteAbsentsProgbat\(client\)/);
  assert.match(lire("src/Renovation/clientsDonnees.js"), /controlerFiche\("client", \{ \.\.\.valeurs, progbat_client_id/);
});

await test("15d. relecture d'une fiche reliée : complète les champs vides, n'écrase rien, aucune écriture ProGBat", async () => {
  const tiers = { id: 151, code: "TESTEUR ANGERS", type: 2, legalType: 1, legalName: "TESTEUR Alice", addresses: [{ byDefault: true, address: "1 rue Fictive", postcode: "49000", city: "Angers", country: "FR", email: "", phone: "", mobile: "06 00 00 00 01" }], contacts: [{ byDefault: true, lastname: "TESTEUR Alice", email: "alice@exemple.test" }] };
  // Fiche créée avant le correctif : nom ProGBat entier, prénom et e-mail vides, téléphone saisi à la main
  const avant = { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", type: "particulier", nom: "TESTEUR Alice", prenom: "", adresse: "1 rue Fictive", code_postal: "49000", ville: "Angers", pays: "France", email: "", telephone: "07 99 99 99 99", code_progbat: "TESTEUR ANGERS", progbat_client_id: "151" };
  assert.equal(A.ficheRelieeIncomplete(avant), true);
  const { patch } = A.completerDepuisTiers(avant, tiers);
  assert.deepEqual(patch, { nom: "TESTEUR", prenom: "Alice", email: "alice@exemple.test" }, "téléphone saisi gardé ; nom ProGBat entier mieux rangé");
  // Nom saisi autrement par l'utilisateur : ni nom ni prénom touchés
  assert.deepEqual(A.completerDepuisTiers({ ...avant, nom: "Testeur-Martin" }, tiers).patch, { email: "alice@exemple.test" });
  // Type différent : rien
  assert.deepEqual(A.completerDepuisTiers({ ...avant, type: "societe" }, tiers).patch, {});
  // Action serveur
  const locaux = [{ ...avant }];
  const appels = [];
  const ctx = {
    appelant: BUREAU, maintenant: MAINTENANT,
    progbat: { async lireTiersUn(id) { appels.push(`GET ${id}`); return id === 151 ? { ok: true, status: 200, data: tiers } : { ok: false, status: 404 }; }, async creerTiers() { throw new Error("ÉCRITURE ProGBat INTERDITE"); } },
    depot: {
      async clientParId(id) { return locaux.find((c) => c.id === id) || null; },
      async completerClient(id, p) { const c = locaux.find((x) => x.id === id); Object.assign(c, p); return { ok: true, client: { ...c } }; },
    },
  };
  assert.equal((await A.traiterRequeteAutomatisation({ action: "relire_client_progbat", clientId: "pas-un-uuid" }, ctx)).body.code, "client_id_invalide");
  assert.equal((await A.traiterRequeteAutomatisation({ action: "relire_client_progbat", clientId: avant.id }, { ...ctx, appelant: null })).http, 401);
  const r = await A.traiterRequeteAutomatisation({ action: "relire_client_progbat", clientId: avant.id }, ctx);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.champs.sort(), ["email", "nom", "prenom"]);
  assert.equal(locaux[0].telephone, "07 99 99 99 99");
  assert.deepEqual(r.body.manquants, []);
  assert.deepEqual(r.body.notes, []);
  assert.equal(A.ficheRelieeIncomplete(locaux[0]), false);
  const r2 = await A.traiterRequeteAutomatisation({ action: "relire_client_progbat", clientId: avant.id }, ctx);
  assert.deepEqual(r2.body.champs, [], "deuxième relecture : rien à faire");
  assert.ok(appels.every((a) => a.startsWith("GET")));
  // Fiche non reliée : refus
  locaux.push({ ...avant, id: "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff", progbat_client_id: null });
  assert.equal((await A.traiterRequeteAutomatisation({ action: "relire_client_progbat", clientId: "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff" }, ctx)).body.code, "non_relie");
  // Branchements : adaptateur serveur, bouton, relecture automatique, journal
  const fn = lire("supabase/functions/progbat-operations/index.ts");
  assert.match(fn, /async clientParId\(/);
  assert.match(fn, /async completerClient\(/);
  assert.match(lire("src/Renovation/ClientsProgbat.jsx"), /Relire depuis ProGBat/);
  assert.match(lire("src/Renovation/OperationCommercial.jsx"), /useRelectureAutoProgbat\(/);
  assert.match(lire("src/Renovation/ComposantsCommerciaux.jsx"), /<NoteClientProgbat/);
  assert.match(lire("src/Renovation/journalMaj.js"), /Client ProGBat existant : toutes ses coordonnées reprises/);
  assert.deepEqual(verifierCopies(), [], "copies serveur à jour (node scripts/sync-progbat-edge-lib.mjs)");
});

await test("15e. diagnostic de remplissage : comptes et noms de champs seulement, jamais une valeur", async () => {
  const D = await imp("src/Renovation/progbatDiagnosticLot4.mjs");
  const items = [
    { id: 1, type: 2, legalType: 1, legalName: "TESTEUR Alice", addresses: [{ email: "alice@exemple.test", phone: "" }], contacts: [] },
    { id: 2, type: 2, legalType: 0, legalName: "SCI FICTIVE", addresses: [], contacts: [{ lastname: "M. Contact" }] },
  ];
  const lus = [];
  const rap = await D.diagnostiquerRemplissageClients({ lire: async (c, { liste }) => { lus.push(c); return liste ? { ok: true, status: 200, data: items } : (/\/(\d+)$/.test(c) ? { ok: true, status: 200, data: items.find((t) => String(t.id) === c.match(/(\d+)$/)[1]) } : { ok: false, status: 404 }); } });
  assert.equal(rap.details_lus, 2);
  assert.equal(rap.remplissage_detail["addresses[].email"], 1);
  assert.equal(rap.remplissage_detail["contacts[] (au moins un)"], 1);
  assert.equal(rap.decoupage_nom_prenom.decoupes, 1);
  const texte = JSON.stringify(rap);
  for (const v of ["alice@exemple.test", "TESTEUR", "SCI FICTIVE", "M. Contact"]) assert.ok(!texte.includes(v), `aucune valeur ne sort (${v})`);
  assert.ok(lus.every((c) => c.startsWith("/company/thirds")));
});

console.log(`verif-refonte-lot4 : OK (${n} tests ; faux client HTTP : aucune écriture sans confirmation ni réservation)`);
