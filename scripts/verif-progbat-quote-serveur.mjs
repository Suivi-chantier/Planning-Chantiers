#!/usr/bin/env node
// Vérifie la logique serveur de création d'un devis brouillon ProGBat
// (src/Renovation/progbatQuoteServeur.mjs) avec des DOUBLURES : aucun appel
// réseau, aucune base. L'API ProGBat réelle n'est jamais touchée.
//   node scripts/verif-progbat-quote-serveur.mjs
import assert from "node:assert/strict";

const srv = await import(new URL("../src/Renovation/progbatQuoteServeur.mjs", import.meta.url).href);
const gen = await import(new URL("../src/Renovation/progbatQuotePayload.mjs", import.meta.url).href);
const genLib = await import(new URL("../supabase/functions/progbat-quote/lib/progbatQuotePayload.mjs", import.meta.url).href);
const srvLib = await import(new URL("../supabase/functions/progbat-quote/lib/progbatQuoteServeur.mjs", import.meta.url).href);
const { traiterRequeteDevis, composerLotsOrdre, LOTS_DEFAUT_LABELS, resumerExport, DELAI_CREATING_INCERTAIN_MS } = srv;

// ── Jeu de données ──────────────────────────────────────────────────────────
const PID = "33082fd2-62e8-4709-a581-34b8c9e7cbeb";
const TAXES = [{ id: 705, rate: 10, label: "10 %", saleDefault: true }, { id: 706, rate: 20, label: "20 %", saleDefault: false }];
const MAINTENANT = new Date("2026-09-14T15:00:00Z");
const projetValide = () => ({
  id: PID, client_nom: "Dupont", client_prenom: "Marie", client_societe: "",
  client_adresse: "12 rue des Lilas", client_code_postal: "49000", client_ville: "Angers", client_pays: "France",
  chantier_adresse: "5 avenue du Parc", chantier_code_postal: "49100", chantier_ville: "Angers", chantier_pays: "France",
  logement_reference: "Appartement 101", type_logement: "T2",
  devis_objet: "Rénovation complète", devis_validite: "2026-10-31", tva_pct: 10, devis_num_commande_client: "",
  progbat_client_id: null, progbat_devis_id: null, progbat_sync_at: null,
});
const ligneValide = (o = {}) => ({
  id: "11111111-1111-1111-1111-111111111111", projet_id: PID, bibliotheque_id: 42, category: "Sol", zone: "Séjour",
  code_ouvrage: "S-001", item: "S-001 : Sol lame PVC", quantite: "25", unite: "m²", prix_unitaire: 49.85, tva_pct: 10,
  cout_total_unitaire: 32.16, coef_vente: 1.55, taux_marge_pct: 35.48, calcul_version: "1@2026-09-14T12:44:32.841Z", ordre: 0, ...o,
});
const BUREAU = { id: "u-bureau", email: "bureau@profero.local", role: "bureau", actif: true };
const OUVRIER = { id: "u-ouvrier", email: "ouvrier@profero.local", role: "ouvrier", actif: true };

// Liaisons ACTUELLES bibliotheque_ratios { id → progbat_id (colonne text) }
const LIAISONS_BASE = { 42: "777", 43: "778" };
const LIAISONS_GEN = { 42: { progbat_id: 777, existe: true } };
// Dépôt en mémoire reproduisant l'index unique partiel (project_id, statut ∈ creating/created/uncertain)
function creerDepot({ projet = projetValide(), lignes = [ligneValide()], exports = [], pannes = {}, liaisons = LIAISONS_BASE } = {}) {
  const etat = { projet: { ...projet }, lignes: [...lignes], exports: [...exports], appels: [], liaisons: { ...liaisons } };
  const depot = {
    etat,
    async chargerLiaisons(ids) { etat.appels.push("chargerLiaisons"); return ids.filter(id => id in etat.liaisons).map(id => ({ id, progbat_id: etat.liaisons[id] })); },
    async chargerProjet(id) { etat.appels.push("chargerProjet"); return id === etat.projet.id ? { ...etat.projet } : null; },
    async chargerLignes() { etat.appels.push("chargerLignes"); return etat.lignes.map(l => ({ ...l })); },
    async chargerLotsOrdre() { return composerLotsOrdre(null, ["Autre"]); },
    async dernierExport(id) { const e = etat.exports.filter(x => x.project_id === id).sort((a, b) => (a.started_at < b.started_at ? 1 : -1)); return e[0] ? { ...e[0] } : null; },
    async reserverExport(ligne) {
      etat.appels.push("reserverExport");
      if (pannes.reservation) return { ok: false, erreur: "connexion perdue" };
      const actif = etat.exports.find(x => x.project_id === ligne.project_id && ["creating", "created", "uncertain"].includes(x.statut));
      if (actif) return { ok: false, conflit: true };
      const id = `exp-${etat.exports.length + 1}`;
      etat.exports.push({ id, ...ligne });
      return { ok: true, id };
    },
    async majExport(id, patch) {
      etat.appels.push(`majExport:${patch.statut ?? "?"}`);
      if (pannes.majExport && patch.statut === "created") return { ok: false, erreur: "disque plein" };
      const e = etat.exports.find(x => x.id === id);
      if (e) Object.assign(e, patch);
      return { ok: true };
    },
    async majProjetDevis(id, patch) {
      etat.appels.push("majProjetDevis");
      if (pannes.majProjet) return { ok: false, erreur: "colonne verrouillée" };
      Object.assign(etat.projet, patch);
      return { ok: true };
    },
  };
  return depot;
}
// Doublure ProGBat : le POST est un MOCK, jamais un appel réel.
function creerProgbat({ taux = TAXES, tauxErreur = null, reponse = { ok: true, status: 201, data: { id: 987654, code: "DEV-2026-0042" } }, delaiRappel = null, lecture = undefined, jetonPresent = true, structures = undefined } = {}) {
  const journal = [];
  return {
    journal,
    jetonPresent,
    async verifierStructures(ids) {
      journal.push("GET /company/library/structures × " + ids.length);
      if (typeof structures === "function") return structures(ids);
      if (structures && structures.ok === false) return structures;
      const introuvables = (structures?.introuvables || []).map(Number);
      return { ok: true, existants: ids.filter(i => !introuvables.includes(i)), introuvables: ids.filter(i => introuvables.includes(i)) };
    },
    ...(lecture === null ? {} : {
      async lireDevis(id) {
        journal.push("GET /company/quotes/" + id);
        if (typeof lecture === "function") return lecture(id);
        return lecture ?? { ok: true, status: 200, data: { id, code: "DEV-2026-0042" } };
      },
    }),
    async lireTaux() { journal.push("GET /company/taxes"); return tauxErreur ? { ok: false, ...tauxErreur } : { ok: true, taux }; },
    async creerDevis(payload) {
      journal.push("POST /company/quotes");
      journal.push({ payload });
      if (delaiRappel) await delaiRappel();
      return typeof reponse === "function" ? reponse(payload) : reponse;
    },
  };
}
const nbPost = (p) => p.journal.filter(j => j === "POST /company/quotes").length;
async function preparer(depot, progbat, appelant = BUREAU) {
  return traiterRequeteDevis({ action: "prepare", projectId: PID }, { appelant, depot, progbat, maintenant: MAINTENANT });
}
async function creer(depot, progbat, hash, { confirmed = true, appelant = BUREAU } = {}) {
  return traiterRequeteDevis({ action: "create", projectId: PID, expectedPayloadHash: hash, confirmed }, { appelant, depot, progbat, maintenant: MAINTENANT });
}

// ── Sérialisation canonique & hash ──────────────────────────────────────────
{
  assert.equal(gen.serialiserCanonique({ b: 1, a: [{ z: 1, y: 2 }, null], c: undefined }), '{"a":[{"y":2,"z":1},null],"b":1}');
  assert.equal(gen.serialiserCanonique({ a: 1, b: 2 }), gen.serialiserCanonique({ b: 2, a: 1 }), "ordre des clés indifférent");
  assert.notEqual(gen.serialiserCanonique({ a: [1, 2] }), gen.serialiserCanonique({ a: [2, 1] }), "ordre des lignes significatif");
  const h1 = await gen.hacherPayload({ a: 1, b: [1, 2] });
  const h2 = await gen.hacherPayload({ b: [1, 2], a: 1 });
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, await gen.hacherPayload({ a: 1, b: [2, 1] }));
}

// ── Parité exacte frontend (src) ↔ serveur (copie lib) ──────────────────────
{
  const args = { projet: projetValide(), lignes: [ligneValide(), ligneValide({ id: "2", zone: "Cuisine", quantite: "2.5" })], lotsOrdre: composerLotsOrdre(null, []), taxes: TAXES, liaisons: LIAISONS_GEN, aujourdHui: MAINTENANT };
  const a = gen.construirePayloadDevisProGBat(args);
  const b = genLib.construirePayloadDevisProGBat(args);
  assert.deepEqual(a.payload, b.payload, "même payload");
  assert.deepEqual(a.erreurs, b.erreurs, "mêmes erreurs");
  assert.deepEqual(a.totaux, b.totaux, "mêmes totaux");
  assert.equal(await gen.hacherPayload(a.payload), await genLib.hacherPayload(b.payload), "même hash canonique");
  assert.equal(typeof srvLib.traiterRequeteDevis, "function", "copie lib du module serveur présente");
}

// ── Ordre des lots = celui de la page Chiffrage ─────────────────────────────
{
  assert.deepEqual(composerLotsOrdre(null, ["Ancien lot"]), [...LOTS_DEFAUT_LABELS, "Ancien lot"]);
  assert.deepEqual(composerLotsOrdre([{ label: "Sol" }, { id: "x" }], []), ["Sol", "Lot 2"]);
  assert.deepEqual(composerLotsOrdre([], ["A", " ", "B"]), [...LOTS_DEFAUT_LABELS, "A", "B"], "liste vide ⇒ défaut");
  // Les libellés par défaut doivent rester alignés sur src/constants.js → LOTS_DEFAUT
  const { readFileSync } = await import("node:fs");
  const constantes = readFileSync(new URL("../src/constants.js", import.meta.url), "utf8");
  const bloc = constantes.slice(constantes.indexOf("export const LOTS_DEFAUT"), constantes.indexOf("];", constantes.indexOf("export const LOTS_DEFAUT")));
  const labels = [...bloc.matchAll(/label:\s*"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...LOTS_DEFAUT_LABELS], labels, "LOTS_DEFAUT_LABELS diverge de constants.js");
}

// ── Accès ───────────────────────────────────────────────────────────────────
{
  const r = await traiterRequeteDevis({ action: "prepare", projectId: PID }, { appelant: null, depot: creerDepot(), progbat: creerProgbat() });
  assert.equal(r.http, 401, "non authentifié");
  const r2 = await preparer(creerDepot(), creerProgbat(), OUVRIER);
  assert.equal(r2.http, 403, "ouvrier refusé");
  const r3 = await preparer(creerDepot(), creerProgbat(), { ...BUREAU, actif: false });
  assert.equal(r3.http, 403, "compte inactif refusé");
  const p = creerProgbat();
  const r4 = await creer(creerDepot(), p, "x", { appelant: OUVRIER });
  assert.equal(r4.http, 403);
  assert.equal(nbPost(p), 0, "aucun POST pour un ouvrier");
  const r5 = await traiterRequeteDevis({ action: "supprimer", projectId: PID }, { appelant: BUREAU, depot: creerDepot(), progbat: creerProgbat() });
  assert.equal(r5.http, 400, "action inconnue");
  const r6 = await traiterRequeteDevis({ action: "prepare", projectId: "abc" }, { appelant: BUREAU, depot: creerDepot(), progbat: creerProgbat() });
  assert.equal(r6.http, 400, "projectId invalide");
  const r7 = await traiterRequeteDevis({ action: "prepare", projectId: "99999999-9999-9999-9999-999999999999" }, { appelant: BUREAU, depot: creerDepot(), progbat: creerProgbat() });
  assert.equal(r7.http, 404, "projet introuvable");
}

// ── prepare : reconstruction serveur, aucun POST ────────────────────────────
let HASH_VALIDE;
{
  const depot = creerDepot(), p = creerProgbat();
  const r = await preparer(depot, p);
  assert.equal(r.http, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.valide, true, JSON.stringify(r.body.erreurs));
  assert.equal(r.body.aucune_ecriture, true);
  assert.match(r.body.payloadHash, /^[0-9a-f]{64}$/);
  assert.equal(r.body.peut_creer, true);
  assert.equal(r.body.export_precedent, null);
  assert.equal(r.body.devis_existant, null);
  assert.equal("payload" in r.body, false, "prepare ne renvoie pas le payload complet");
  assert.deepEqual(r.body.taux.map(t => t.id), [705, 706]);
  assert.equal(nbPost(p), 0, "prepare : aucun POST");
  assert.ok(!depot.etat.appels.includes("reserverExport"), "prepare : aucune réservation");
  HASH_VALIDE = r.body.payloadHash;
  // Le hash serveur est celui du générateur partagé sur les mêmes données
  const local = gen.construirePayloadDevisProGBat({ projet: projetValide(), lignes: [ligneValide()], lotsOrdre: composerLotsOrdre(null, ["Autre"]), taxes: TAXES, liaisons: r.body.liaisons, aujourdHui: MAINTENANT });
  assert.equal(await gen.hacherPayload(local.payload), HASH_VALIDE, "parité aperçu local / serveur (liaisons renvoyées par prepare)");
  assert.deepEqual(r.body.liaisons, { 42: { progbat_id: 777, existe: true } }, "prepare renvoie les liaisons vérifiées");
  assert.equal(r.body.compteurs.lies, 1);
  assert.ok(p.journal.includes("GET /company/library/structures × 1"), "structure vérifiée par l'API");
}
{
  const depot = creerDepot({ projet: { ...projetValide(), devis_validite: null } });
  const r = await preparer(depot, creerProgbat());
  assert.equal(r.body.valide, false);
  assert.equal(r.body.peut_creer, false);
  assert.ok(r.body.erreurs.some(e => e.code === "validite_absente"));
}
{
  const r = await preparer(creerDepot(), creerProgbat({ tauxErreur: { status: 403, message: "scope manquant" } }));
  assert.equal(r.http, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.code, "taux_tva_indisponibles");
}

// ── create : refus avant tout POST ──────────────────────────────────────────
{
  const p = creerProgbat();
  const r = await creer(creerDepot(), p, HASH_VALIDE, { confirmed: false });
  assert.equal(r.http, 400); assert.equal(r.body.code, "confirmation_requise"); assert.equal(nbPost(p), 0, "absence de confirmation");
  const r2 = await traiterRequeteDevis({ action: "create", projectId: PID, expectedPayloadHash: HASH_VALIDE, confirmed: "true" }, { appelant: BUREAU, depot: creerDepot(), progbat: p });
  assert.equal(r2.body.code, "confirmation_requise", "confirmed doit être le booléen true");
}
{
  const p = creerProgbat();
  const r = await creer(creerDepot(), p, "0000000000000000000000000000000000000000000000000000000000000000");
  assert.equal(r.http, 409); assert.equal(r.body.code, "hash_different"); assert.equal(nbPost(p), 0, "hash différent : aucun POST");
  assert.equal(r.body.payloadHash, HASH_VALIDE, "le hash serveur actuel est renvoyé pour relancer l'aperçu");
}
{
  // projet modifié après l'aperçu (quantité changée) ⇒ hash serveur différent ⇒ refus
  const depot = creerDepot({ lignes: [ligneValide({ quantite: "26" })] }), p = creerProgbat();
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.code, "hash_different"); assert.equal(nbPost(p), 0, "projet modifié : aucun POST");
  assert.equal(depot.etat.exports.length, 0, "aucune réservation");
}
{
  const depot = creerDepot({ projet: { ...projetValide(), devis_objet: "" } }), p = creerProgbat();
  const prep = await preparer(depot, p);
  const r = await creer(depot, p, prep.body.payloadHash);
  assert.equal(r.http, 409); assert.equal(r.body.code, "payload_invalide"); assert.equal(nbPost(p), 0, "payload invalide : aucun POST");
  assert.ok(r.body.erreurs.some(e => e.code === "objet_absent"));
}
{
  const depot = creerDepot({ projet: { ...projetValide(), progbat_devis_id: "555" } }), p = creerProgbat();
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.http, 409); assert.equal(r.body.code, "devis_deja_cree"); assert.equal(nbPost(p), 0, "devis déjà créé (colonne projet)");
}
{
  const exports = [{ id: "e1", project_id: PID, statut: "created", payload_hash: "ancien", progbat_quote_id: 4242, started_at: "2026-09-14T14:00:00Z", finished_at: "2026-09-14T14:00:02Z" }];
  const depot = creerDepot({ exports }), p = creerProgbat();
  const prep = await preparer(depot, p);
  assert.equal(prep.body.devis_existant.progbat_quote_id, 4242);
  assert.equal(prep.body.chiffrage_modifie_depuis, true, "hash envoyé ≠ hash actuel ⇒ chiffrage modifié");
  assert.equal(prep.body.peut_creer, false);
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.code, "devis_deja_cree"); assert.equal(nbPost(p), 0, "devis déjà créé (export)");
  const avant = p.journal.length;   // prepare et create ont chacun lu les taux (GET)
  const st = await traiterRequeteDevis({ action: "status", projectId: PID }, { appelant: BUREAU, depot, progbat: p, maintenant: MAINTENANT });
  assert.equal(st.body.devis_existant.progbat_quote_id, 4242);
  assert.equal(st.body.motif_blocage.code, "devis_deja_cree");
  assert.equal(st.body.aucune_ecriture, true);
  assert.equal(p.journal.length, avant, "status : aucun appel ProGBat");
  assert.equal(nbPost(p), 0, "aucun POST dans tout ce scénario");
}
{
  const exports = [{ id: "e1", project_id: PID, statut: "uncertain", payload_hash: "h", started_at: "2026-09-14T14:00:00Z", error_message: "délai" }];
  const depot = creerDepot({ exports }), p = creerProgbat();
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.http, 409); assert.equal(r.body.code, "etat_incertain"); assert.equal(nbPost(p), 0, "état incertain : nouvelle tentative interdite");
  assert.match(r.body.error, /manuellement/);
}
{
  const exports = [{ id: "e1", project_id: PID, statut: "creating", payload_hash: "h", started_at: MAINTENANT.toISOString() }];
  const r = await creer(creerDepot({ exports }), creerProgbat(), HASH_VALIDE);
  assert.equal(r.body.code, "creation_en_cours", "création en cours");
  const vieux = [{ id: "e1", project_id: PID, statut: "creating", payload_hash: "h", started_at: new Date(MAINTENANT.getTime() - DELAI_CREATING_INCERTAIN_MS - 1000).toISOString() }];
  const r2 = await creer(creerDepot({ exports: vieux }), creerProgbat(), HASH_VALIDE);
  assert.equal(r2.body.code, "etat_incertain", "réservation figée depuis trop longtemps ⇒ incertain");
  assert.equal(resumerExport(vieux[0], MAINTENANT).reservation_figee, true);
}

// ── create : succès 201 simulé ──────────────────────────────────────────────
{
  const depot = creerDepot(), p = creerProgbat();
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.http, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.statut, "created");
  assert.equal(r.body.progbat_quote_id, 987654);
  assert.equal(r.body.progbat_quote_code, "DEV-2026-0042");
  assert.equal(nbPost(p), 1, "exactement un POST");
  const exp = depot.etat.exports[0];
  assert.equal(exp.statut, "created");
  assert.equal(exp.progbat_quote_id, 987654);
  assert.equal(exp.payload_hash, HASH_VALIDE);
  assert.equal(exp.http_status, 201);
  assert.equal(exp.created_by, "u-bureau");
  assert.ok(exp.finished_at);
  assert.equal(depot.etat.projet.progbat_devis_id, "987654", "colonne projet renseignée");
  assert.ok(depot.etat.projet.progbat_sync_at);
  // la réservation précède le POST
  const iRes = depot.etat.appels.indexOf("reserverExport");
  assert.ok(iRes >= 0);
  const envoye = p.journal.find(j => typeof j === "object").payload;
  const json = JSON.stringify(envoye);
  assert.equal(envoye.content[0].content[0].content[0].elementId, 777, "elementId de la liaison actuelle dans le payload envoyé");
  assert.ok(!/cout|marge|coef|bibliotheque|progbat_|elementType/i.test(json), "aucune donnée interne dans le payload envoyé");
  assert.deepEqual(gen.auditerPayload(envoye, { elementIdsAutorises: [777] }), []);
  assert.equal(r.body.journal, undefined);
  assert.deepEqual(Object.keys(r.journal).sort(), ["action", "duree_ms", "endpoint", "http_status", "progbat_quote_id", "projectId", "statut", "verification"], "journal : champs autorisés seulement");
  // second clic après succès ⇒ refus, aucun nouveau POST
  const r2 = await creer(depot, p, HASH_VALIDE);
  assert.equal(r2.body.code, "devis_deja_cree"); assert.equal(nbPost(p), 1, "double clic après succès");
}

// ── Double clic / appels concurrents ────────────────────────────────────────
{
  let liberer; const attente = new Promise(res => { liberer = res; });
  const depot = creerDepot(), p = creerProgbat({ delaiRappel: () => attente });
  const c1 = creer(depot, p, HASH_VALIDE);
  await new Promise(r => setTimeout(r, 20));          // c1 a réservé et attend ProGBat
  const c2 = creer(depot, p, HASH_VALIDE);            // second clic pendant l'appel
  const r2 = await c2;
  assert.equal(r2.http, 409); assert.equal(r2.body.code, "creation_en_cours", "second appel refusé pendant la création");
  liberer();
  const r1 = await c1;
  assert.equal(r1.body.statut, "created");
  assert.equal(nbPost(p), 1, "deux appels concurrents ⇒ un seul POST");
  assert.equal(depot.etat.exports.length, 1);
}
{
  // Course parfaite : deux réservations simultanées, l'index unique n'en accepte qu'une
  const depot = creerDepot(), p = creerProgbat();
  const [a, b] = await Promise.all([creer(depot, p, HASH_VALIDE), creer(depot, p, HASH_VALIDE)]);
  const codes = [a.body.statut ?? a.body.code, b.body.statut ?? b.body.code].sort();
  assert.deepEqual(codes, ["created", "creation_en_cours"]);
  assert.equal(nbPost(p), 1);
}

// ── Erreurs ProGBat simulées ────────────────────────────────────────────────
for (const [status, attendu] of [[400, /400/], [401, /401/], [403, /403/], [409, /409/], [422, /422/], [429, /429/]]) {
  const depot = creerDepot(), p = creerProgbat({ reponse: { ok: false, status, message: `HTTP ${status} simulé` } });
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.http, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.statut, "failed", `HTTP ${status} ⇒ failed (refus certain avant création)`);
  assert.equal(r.body.progbat_status, status);
  assert.match(r.body.error, attendu);
  assert.equal(depot.etat.exports[0].statut, "failed");
  assert.equal(depot.etat.exports[0].http_status, status);
  assert.equal(depot.etat.projet.progbat_devis_id, null, "aucun identifiant enregistré");
  // un échec ne bloque pas une nouvelle tentative (manuelle)
  const p2 = creerProgbat();
  const r2 = await creer(depot, p2, HASH_VALIDE);
  assert.equal(r2.body.statut, "created", `après un ${status}, une nouvelle tentative est possible`);
}
for (const status of [500, 502, 503]) {
  const depot = creerDepot(), p = creerProgbat({ reponse: { ok: false, status, message: `HTTP ${status} simulé` } });
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.statut, "uncertain", `HTTP ${status} après envoi du POST ⇒ incertain`);
  assert.equal(r.body.verification_manuelle, true);
  assert.equal(depot.etat.exports[0].statut, "uncertain");
  assert.equal(depot.etat.exports[0].http_status, status);
  const r2 = await creer(depot, creerProgbat(), HASH_VALIDE);
  assert.equal(r2.body.code, "etat_incertain", `après un ${status}, aucune relance`);
  assert.equal(nbPost(p), 1, "aucun second POST");
}
{
  const depot = creerDepot(), p = creerProgbat({ reponse: { ok: false, status: 0, message: "socket fermée", reseau: true } });
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.statut, "uncertain", "erreur réseau ⇒ incertain");
  const r2 = await creer(depot, creerProgbat(), HASH_VALIDE);
  assert.equal(r2.body.code, "etat_incertain"); assert.equal(nbPost(p), 1);
}
{
  const depot = creerDepot(), p = creerProgbat({ reponse: { ok: false, status: 0, message: "délai dépassé", timeout: true } });
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.statut, "uncertain", "délai dépassé ⇒ incertain");
  assert.equal(r.body.verification_manuelle, true);
  assert.equal(depot.etat.exports[0].statut, "uncertain");
  const r2 = await creer(depot, creerProgbat(), HASH_VALIDE);
  assert.equal(r2.body.code, "etat_incertain", "jamais de relance automatique après un état incertain");
  assert.equal(nbPost(p), 1);
}
{
  const depot = creerDepot(), p = creerProgbat({ reponse: { ok: true, status: 201, data: { code: "DEV-1" } } });
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.statut, "uncertain", "identifiant absent de la réponse ⇒ incertain");
  assert.equal(r.body.code, "identifiant_absent");
  assert.equal(depot.etat.projet.progbat_devis_id, null);
}
{
  const depot = creerDepot({ pannes: { majExport: true } }), p = creerProgbat();
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.statut, "uncertain", "échec de sauvegarde locale après succès distant ⇒ incertain");
  assert.equal(r.body.code, "enregistrement_local_incomplet");
  assert.equal(r.body.progbat_quote_id, 987654, "l'identifiant connu est rendu pour la vérification manuelle");
  assert.equal(depot.etat.exports[0].statut, "uncertain");
  assert.equal(depot.etat.exports[0].progbat_quote_id, 987654);
  const r2 = await creer(depot, creerProgbat(), HASH_VALIDE);
  assert.equal(r2.body.code, "etat_incertain"); assert.equal(nbPost(p), 1);
}
{
  const depot = creerDepot({ pannes: { majProjet: true } }), p = creerProgbat();
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.statut, "uncertain", "colonne projet non mise à jour ⇒ incertain");
  assert.equal(depot.etat.exports[0].progbat_quote_id, 987654);
}
{
  const depot = creerDepot({ pannes: { reservation: true } }), p = creerProgbat();
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.http, 500); assert.equal(r.body.code, "reservation_impossible"); assert.equal(nbPost(p), 0, "réservation impossible ⇒ aucun POST");
}

// ── Vérification GET après succès : jamais de second POST ───────────────────
{
  const depot = creerDepot(), p = creerProgbat();
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.statut, "created");
  assert.deepEqual(r.body.verification, { ok: true, status: 200, id_confirme: true });
  assert.ok(p.journal.includes("GET /company/quotes/987654"), "relecture GET officielle");
  assert.ok(depot.etat.exports[0].verified_at, "verified_at enregistré");
  assert.equal(depot.etat.exports[0].verification_http_status, 200);
  assert.equal(r.body.created_by_email, "bureau@profero.local");
  assert.ok(r.body.finished_at);
  assert.equal(nbPost(p), 1);
}
{
  const depot = creerDepot(), p = creerProgbat({ lecture: { ok: false, status: 500, message: "indisponible" } });
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.statut, "created", "échec de la relecture : le devis reste créé");
  assert.equal(r.body.verification.ok, false);
  assert.equal(depot.etat.exports[0].statut, "created");
  assert.equal(depot.etat.exports[0].verified_at, null);
  assert.equal(nbPost(p), 1, "aucun second POST après un GET en échec");
}
{
  const depot = creerDepot(), p = creerProgbat({ lecture: () => { throw new Error("réseau"); } });
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.statut, "created"); assert.equal(r.body.verification.ok, false); assert.equal(nbPost(p), 1);
}
{
  const depot = creerDepot(), p = creerProgbat({ lecture: null });   // adaptateur sans lireDevis
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.statut, "created"); assert.equal(r.body.verification, null);
}

// ── Clé du logement : référence confirmée ≠ projet rechargé ⇒ refus ─────────
{
  const depot = creerDepot(), p = creerProgbat();
  const r = await traiterRequeteDevis({ action: "create", projectId: PID, logementReference: "Appartement 102", expectedPayloadHash: HASH_VALIDE, confirmed: true }, { appelant: BUREAU, depot, progbat: p, maintenant: MAINTENANT });
  assert.equal(r.http, 409); assert.equal(r.body.code, "logement_different"); assert.equal(nbPost(p), 0);
  const ok = await traiterRequeteDevis({ action: "create", projectId: PID, logementReference: "Appartement 101", expectedPayloadHash: HASH_VALIDE, confirmed: true }, { appelant: BUREAU, depot, progbat: p, maintenant: MAINTENANT });
  assert.equal(ok.body.statut, "created");
  assert.equal(depot.etat.exports[0].logement_reference, "Appartement 101", "référence du logement figée dans la réservation");
  const prep = await preparer(creerDepot(), creerProgbat());
  assert.equal(prep.body.logement_reference, "Appartement 101");
}

// ── Absence du jeton : aucune opération, aucun POST, aucune réservation ─────
{
  const depot = creerDepot(), p = creerProgbat({ jetonPresent: false });
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.http, 500); assert.equal(r.body.code, "secret_absent");
  assert.equal(nbPost(p), 0); assert.equal(p.journal.length, 0, "aucun appel ProGBat"); assert.equal(depot.etat.exports.length, 0);
  const r2 = await preparer(depot, p);
  assert.equal(r2.body.code, "secret_absent");
  assert.ok(!JSON.stringify(r.body).includes("PROGBAT_PRIVATE"), "le nom du secret n'est pas exposé au navigateur");
}

// ── Aucune fuite de secret ni de corps brut ─────────────────────────────────
{
  const SECRET = "FAUXJETON_TEST_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";   // faux jeton, sans format reel
  const fuite = (r) => { const j = JSON.stringify(r.body) + JSON.stringify(r.journal ?? {}); return j.includes(SECRET) || j.includes("Bearer "); };
  const r1 = await creer(creerDepot(), creerProgbat({ reponse: { ok: false, status: 401, message: `Unauthorized Bearer ${SECRET} rejected` } }), HASH_VALIDE);
  assert.equal(r1.body.statut, "failed"); assert.ok(!fuite(r1), "message d'erreur ProGBat nettoyé");
  assert.ok(r1.body.error.includes("[masqué]"), "la séquence longue est masquée");
  const r2 = await creer(creerDepot(), creerProgbat({ reponse: { ok: false, status: 503, message: `upstream ${SECRET}` } }), HASH_VALIDE);
  assert.equal(r2.body.statut, "uncertain"); assert.ok(!fuite(r2));
  const r3 = await creer(creerDepot(), creerProgbat({ reponse: { ok: true, status: 201, data: { id: 42, code: "DEV-1", token: SECRET, content: [{ secret: SECRET }] } }, lecture: { ok: true, status: 200, data: { id: 42, token: SECRET } } }), HASH_VALIDE);
  assert.equal(r3.body.statut, "created"); assert.ok(!fuite(r3), "la réponse brute ProGBat n'est jamais renvoyée");
  assert.ok(!("data" in r3.body) && !("content" in r3.body), "seuls id et code sont extraits");
  const r4 = await creer(creerDepot({ pannes: { reservation: true } }), creerProgbat(), HASH_VALIDE);
  assert.ok(!fuite(r4));
  const r5 = await creer(creerDepot(), creerProgbat({ tauxErreur: { status: 403, message: `forbidden ${SECRET}` } }), HASH_VALIDE);
  assert.ok(!fuite(r5));
}

// ── Liaison ProGBat côté serveur ────────────────────────────────────────────
{
  // ouvrage Profero sans progbat_id ⇒ aperçu invalide, création refusée, aucun POST
  const depot = creerDepot({ liaisons: { 42: null } }), p = creerProgbat();
  const prep = await preparer(depot, p);
  assert.equal(prep.body.valide, false);
  assert.ok(prep.body.erreurs.some(e => e.code === "ouvrage_non_lie" && e.message === "S-001 — ouvrage non lié à la bibliothèque ProGBat"));
  assert.equal(prep.body.compteurs.lies, 0);
  assert.equal(prep.body.peut_creer, false);
  const r = await creer(depot, p, prep.body.payloadHash);
  assert.equal(r.body.code, "payload_invalide"); assert.equal(nbPost(p), 0);
}
{
  const depot = creerDepot({ liaisons: { 42: "abc" } });
  const prep = await preparer(depot, creerProgbat());
  assert.ok(prep.body.erreurs.some(e => e.code === "progbat_id_invalide"), "progbat_id invalide");
}
{
  // structure supprimée dans ProGBat (404) ⇒ bloqué
  const depot = creerDepot(), p = creerProgbat({ structures: { introuvables: [777] } });
  const prep = await preparer(depot, p);
  assert.ok(prep.body.erreurs.some(e => e.code === "structure_introuvable"));
  assert.deepEqual(prep.body.liaisons, { 42: { progbat_id: 777, existe: false } });
  const r = await creer(depot, p, prep.body.payloadHash);
  assert.equal(r.body.code, "payload_invalide"); assert.equal(nbPost(p), 0);
}
{
  // vérification impossible (ProGBat 500 sur le GET) ⇒ aucune création
  const depot = creerDepot(), p = creerProgbat({ structures: { ok: false, status: 500, message: "indisponible" } });
  const prep = await preparer(depot, p);
  assert.equal(prep.body.ok, false); assert.equal(prep.body.code, "structures_non_verifiables");
  const r = await creer(depot, p, "x");
  assert.equal(r.body.code, "structures_non_verifiables"); assert.equal(nbPost(p), 0);
}
{
  // ancien identifiant dans le snapshot mais liaison actuelle absente ⇒ bloqué
  const depot = creerDepot({ lignes: [ligneValide({ progbat_ligne_id: "999" })], liaisons: {} });
  const prep = await preparer(depot, creerProgbat());
  assert.equal(prep.body.valide, false); assert.ok(prep.body.erreurs.some(e => e.code === "ouvrage_non_lie"));
}
{
  // injection depuis le navigateur : elementId / content / prix ignorés, reconstruction serveur seule
  const depot = creerDepot(), p = creerProgbat();
  const r = await traiterRequeteDevis({ action: "create", projectId: PID, expectedPayloadHash: HASH_VALIDE, confirmed: true, elementId: 999, content: [{ lineType: "element", elementId: 999, netUnitPrice: 1 }], payload: { content: [] }, netUnitPrice: 1 }, { appelant: BUREAU, depot, progbat: p, maintenant: MAINTENANT });
  assert.equal(r.body.statut, "created");
  const envoye = p.journal.find(j => typeof j === "object").payload;
  assert.equal(envoye.content[0].content[0].content[0].elementId, 777, "elementId du navigateur ignoré");
  assert.equal(envoye.content[0].content[0].content[0].netUnitPrice, 49.85, "prix du navigateur ignoré");
  assert.ok(!JSON.stringify(envoye).includes("999"));
}
{
  // devis hybride interdit : deux ouvrages, un seul lié
  const depot = creerDepot({ lignes: [ligneValide(), ligneValide({ id: "22222222-2222-2222-2222-222222222222", zone: "Cuisine", bibliotheque_id: 43, code_ouvrage: "S-002", item: "S-002 : Plinthes" })], liaisons: { 42: "777", 43: null } }), p = creerProgbat();
  const prep = await preparer(depot, p);
  assert.equal(prep.body.valide, false);
  assert.equal(prep.body.compteurs.lies, 1); assert.equal(prep.body.compteurs.lignes, 2);
  assert.ok(prep.body.erreurs.some(e => e.code === "ouvrages_non_lies" && /1 \/ 2/.test(e.message)));
  const r = await creer(depot, p, prep.body.payloadHash);
  assert.equal(r.body.code, "payload_invalide"); assert.equal(nbPost(p), 0);
  // les deux liés ⇒ valide, deux elementId distincts
  const depot2 = creerDepot({ lignes: depot.etat.lignes, liaisons: { 42: "777", 43: "778" } }), p2 = creerProgbat();
  const prep2 = await preparer(depot2, p2);
  assert.equal(prep2.body.valide, true); assert.equal(prep2.body.compteurs.lies, 2);
  const r2 = await creer(depot2, p2, prep2.body.payloadHash);
  assert.equal(r2.body.statut, "created");
  const ids = p2.journal.find(j => typeof j === "object").payload.content.flatMap(l => l.content.flatMap(z => z.content)).map(e => e.elementId).sort();
  assert.deepEqual(ids, [777, 778]);
}
{
  // le plan change (liaison modifiée entre l'aperçu et la confirmation) ⇒ hash différent, aucun POST
  const depot = creerDepot(), p = creerProgbat();
  const prep = await preparer(depot, p);
  depot.etat.liaisons[42] = "778";
  const r = await creer(depot, p, prep.body.payloadHash);
  assert.equal(r.body.code, "hash_different", "elementId intégré au hash"); assert.equal(nbPost(p), 0);
  const prep2 = await preparer(depot, p);
  assert.notEqual(prep2.body.payloadHash, prep.body.payloadHash);
  const ok = await creer(depot, p, prep2.body.payloadHash);
  assert.equal(ok.body.statut, "created");
}
{
  // incertain après POST : toujours aucun second POST, même avec liaisons valides
  const depot = creerDepot(), p = creerProgbat({ reponse: { ok: false, status: 0, message: "délai", timeout: true } });
  const r = await creer(depot, p, HASH_VALIDE);
  assert.equal(r.body.statut, "uncertain");
  const r2 = await creer(depot, creerProgbat(), HASH_VALIDE);
  assert.equal(r2.body.code, "etat_incertain"); assert.equal(nbPost(p), 1);
}

console.log("verif-progbat-quote-serveur : OK (accès, jeton absent, prepare, refus, logement, liaisons elementId vérifiées, hybride interdit, injection ignorée, 201 + GET de vérification, 400/401/403/409/422/429 → failed, 5xx/délai/réseau → incertain, id absent, sauvegarde locale, concurrence, aucune fuite de secret, parité src/lib)");
