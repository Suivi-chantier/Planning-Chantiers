// Vérifie le lot 3 de la Refonte Opérations : cycle de vie en 5 phases, reprise
// à la lecture de l'ancien cycle, étapes automatiques et partagée, liens
// ProGBat et Google Agenda (modules uniques), relances e-mail (décision pure,
// interrupteur ÉTEINT par défaut, anti-doublon), synthèse d'opération,
// migration additive. Aucun réseau, aucune base, aucun e-mail : données
// fictives construites ici (exemples issus des tests, données fictives), et
// une base simulée en mémoire pour la tâche planifiée.
//   node scripts/verif-refonte-lot3.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  CYCLE_VIE_PHASES, CYCLE_VIE_ETAPES, getEtape, nomEtape, evaluerEtape, computeCycleVie,
  etatsCycleVie, phaseDeclareeCycleVie, etatAcompteChantier, etatPhasageMateriaux, autorisationPartagee,
  resumeCycleVieChantier, syntheseCycleVieOperation,
} from "../src/Renovation/cycleVie.mjs";
import {
  CORRESPONDANCE_ANCIENNES_ETAPES, CORRESPONDANCE_ANCIENNES_PHASES, etatsEtapesRepris, etatPourEcriture, bilanReprise,
} from "../src/Renovation/cycleVieReprise.mjs";
import {
  decisionRelance, lireReglagesRelances, planifierRelances, referencesRelances, construireDossiersRelances,
  contenuEmailRelance, emailCompte, DELAI_RELANCE_DEFAUT, CLE_REGLAGES_RELANCES,
} from "../src/Renovation/relancesCycleVie.mjs";
import {
  lienProgbat, urlDevisProgbat, urlFactureProgbat, urlListeFacturesSurligneeProgbat, urlListeFacturesProgbat,
  urlChantierProgbat, urlListeClientsProgbat, PROGBAT_AVERTISSEMENT_ENTREPRISE,
} from "../src/Renovation/progbatLiens.mjs";
import { lienGoogleAgenda, adresseChantierAgenda } from "../src/Renovation/agendaGoogle.mjs";
import { ETAPE_SIGNATURE, decisionBasculeSignature } from "../src/Renovation/statutsChantier.mjs";
import { declencheurAtteint } from "../src/Renovation/facturationClient.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*(\/\/|--)/.test(l)).join("\n");
const require = createRequire(import.meta.url);

let n = 0;
async function test(nom, fn) { await fn(); n++; console.log("ok -", nom); }

// ─── 1. Modules purs ────────────────────────────────────────────────────────
await test("1. modules purs (ni Supabase, ni horloge, ni réseau) et façades .js", () => {
  for (const f of ["cycleVie", "cycleVieReprise", "relancesCycleVie", "progbatLiens", "agendaGoogle"]) {
    const chemin = `src/Renovation/${f}.mjs`;
    const s = sansCommentaires(lire(chemin));
    assert.ok(!/supabase/i.test(s), `${chemin} : aucun accès Supabase`);
    assert.ok(!/Date\.now\s*\(|new Date\(\s*\)/.test(s), `${chemin} : aucune horloge`);
    assert.ok(!/\bfetch\s*\(|\.from\s*\(\s*["']|\.rpc\s*\(/.test(s), `${chemin} : aucun réseau ni base`);
    assert.match(lire(`src/Renovation/${f}.js`), new RegExp(`export \\* from "\\./${f}\\.mjs"`), `façade ${f}.js`);
  }
});

// ─── 2. Les 5 phases et leurs étapes ────────────────────────────────────────
await test("2. cinq phases, étapes et modes de validation du cahier des charges", () => {
  assert.deepEqual(CYCLE_VIE_PHASES.map((p) => p.nom), ["Étude", "Contrat", "Préparation", "Travaux", "Réception"]);
  const ids = (phaseId) => CYCLE_VIE_PHASES.find((p) => p.id === phaseId).etapes.map((e) => `${e.id}:${e.nature}`);
  assert.deepEqual(ids("cv_etude"), ["visite_chiffrage:coche", "chiffrage_realise:auto", "devis_envoye:document", "relance_devis:auto"]);
  assert.deepEqual(ids("cv_contrat"), ["devis_signe:document", "acompte_encaisse:auto", "relance_acompte:auto", "autorisation_recue:coche"]);
  assert.deepEqual(ids("cv_preparation"), ["visite_conducteur_ca:coche", "plans_techniques:document", "phasage_cree:auto", "planning_previsionnel:document", "visite_conducteur_chef:coche", "preparation_finalisee:coche"]);
  assert.equal(CYCLE_VIE_PHASES.find((p) => p.id === "cv_travaux").dynamique, true, "Travaux : une étape par groupe");
  assert.deepEqual(ids("cv_reception"), ["pre_reception:auto", "reception_pv:document", "levee_reserves:coche", "facture_solde:auto"]);
  // Boutons et signaux
  for (const id of ["visite_chiffrage", "visite_conducteur_ca", "visite_conducteur_chef"]) assert.ok(getEtape(id).agenda, `${id} : bouton Google Agenda`);
  assert.equal(getEtape("devis_envoye").progbat, "devis");
  assert.equal(getEtape("devis_signe").progbat, "devis");
  assert.equal(getEtape("acompte_encaisse").progbat, "facture_acompte");
  assert.equal(getEtape("facture_solde").progbat, "facture_solde");
  assert.equal(getEtape("chiffrage_realise").signal, "chiffrage_existant");
  assert.equal(getEtape("relance_devis").relance, "devis");
  assert.equal(getEtape("relance_acompte").relance, "acompte");
  assert.equal(getEtape("autorisation_recue").partagee, true);
  assert.ok(getEtape("devis_signe").champs.some((c) => c.type === "date"), "date de signature");
  assert.ok(getEtape("reception_pv").champs.some((c) => c.type === "date"), "date de réception");
  assert.match(getEtape("planning_previsionnel").accept, /pdf/);
  // Disparues
  for (const ancien of ["metres", "reponse_client", "retractation_purgee", "commandes_appros", "equipes_affectees",
    "installation_chantier", "remise_cles_doe", "parfait_achevement", "interventions_sav", "fin_garantie", "visite_reception", "plans_execution"]) {
    assert.equal(getEtape(ancien), null, `${ancien} ne fait plus partie du cycle`);
  }
  assert.ok(!CYCLE_VIE_PHASES.some((p) => /garantie|sav|cl[ôo]ture/i.test(p.nom)), "ni Garanties/SAV ni Clôture");
  assert.equal(new Set(CYCLE_VIE_ETAPES.map((e) => e.id)).size, CYCLE_VIE_ETAPES.length, "identifiants uniques");
});

// ─── 3. Signature et bascule ────────────────────────────────────────────────
await test("3. ETAPE_SIGNATURE pointe sur « Devis signé » (phase Contrat) ; la bascule lit les états repris", () => {
  assert.equal(ETAPE_SIGNATURE, "devis_signe");
  assert.equal(getEtape(ETAPE_SIGNATURE).nom, "Devis signé");
  assert.equal(getEtape(ETAPE_SIGNATURE).phaseId, "cv_contrat");
  const { etats } = etatsCycleVie({ meta: null, lignes: [{ chantier_id: "c", etape_id: "devis_signe", etat: { fait: true, date: "2026-11-06T10:00:00Z" } }] });
  assert.equal(decisionBasculeSignature({ id: "c", statut: "a_l_etude" }, etats).basculer, true);
  assert.equal(decisionBasculeSignature({ id: "c", statut: "perdu" }, etats).basculer, false);
});

// ─── 4. Reprise à la lecture ────────────────────────────────────────────────
// Exemple issu des tests, données fictives.
const META_ANCIEN = Object.freeze({
  cycle_vie_etapes: Object.freeze({
    metres: Object.freeze({ fait: true, date: "2026-05-02T08:00:00Z", auteur: "Loris" }),
    reponse_client: Object.freeze({ fait: true, donnees: Object.freeze({ reponse: "accepte" }), pieces_jointes: Object.freeze([Object.freeze({ path: "cycle-vie/p/reponse_client/1_mail.pdf", nom: "mail.pdf" })]) }),
    devis_signe: Object.freeze({ fait: true, date: "2026-05-20T10:00:00Z", donnees: Object.freeze({ date: "2026-05-19" }) }),
    acompte_encaisse: Object.freeze({ fait: true, date: "2026-05-30T09:00:00Z", auteur: "Camille", donnees: Object.freeze({ montant: 1000 }) }),
    plans_execution: Object.freeze({ fait: true, pieces_jointes: Object.freeze([Object.freeze({ path: "x/plan.pdf", nom: "plan.pdf" })]) }),
    visite_reception: Object.freeze({ fait: true, donnees: Object.freeze({ date: "2026-09-01" }) }),
    situation_100: Object.freeze({ fait: true }),
  }),
  cycle_vie_phase_declaree: Object.freeze({ phaseId: "cv_garanties", auteur: "Loris", date: "2026-10-01" }),
});

await test("4. reprise : équivalents reportés, autres conservés hors cycle, données d'origine intactes", () => {
  const avant = JSON.stringify(META_ANCIEN);
  const { etats, nonReprises } = etatsEtapesRepris({ meta: META_ANCIEN, lignes: [] });
  assert.equal(JSON.stringify(META_ANCIEN), avant, "l'ancien état n'est jamais modifié");
  assert.equal(etats.visite_chiffrage.fait, true);
  assert.deepEqual(etats.visite_chiffrage.reprise, { depuis: "metres", nom: "Métrés" });
  assert.equal(etats.plans_techniques.pieces_jointes.length, 1, "les plans d'exécution suivent");
  assert.equal(etats.reception_pv.donnees.date, "2026-09-01");
  assert.equal(etats.devis_signe.fait, true);
  assert.equal(etats.reponse_client, undefined, "Réponse client : plus dans le cycle");
  assert.deepEqual(nonReprises.map((x) => x.id).sort(), ["reponse_client", "situation_100"]);
  assert.equal(nonReprises.find((x) => x.id === "reponse_client").etat.pieces_jointes.length, 1, "ses pièces restent consultables");
  // La table prime
  const t = etatsEtapesRepris({ meta: META_ANCIEN, lignes: [{ chantier_id: "c", etape_id: "visite_chiffrage", etat: { fait: false } }] });
  assert.equal(t.etats.visite_chiffrage.fait, false);
  assert.equal(t.etats.visite_chiffrage.reprise, undefined);
  // Écriture : la marque de lecture ne part pas en base
  assert.equal(etatPourEcriture(etats.visite_chiffrage).reprise, undefined);
  // Toute ancienne étape est classée (équivalent ou sans équivalent)
  for (const [ancien, nouveau] of Object.entries(CORRESPONDANCE_ANCIENNES_ETAPES)) {
    if (nouveau) assert.ok(getEtape(nouveau), `${ancien} → ${nouveau} existe`);
  }
  // Phase déclarée
  assert.equal(CORRESPONDANCE_ANCIENNES_PHASES.cv_devis, "cv_etude");
  assert.equal(phaseDeclareeCycleVie({ meta: META_ANCIEN }).phaseId, "cv_reception");
  assert.equal(phaseDeclareeCycleVie({ meta: META_ANCIEN, lignes: [{ etape_id: "_phase_declaree", etat: { phaseId: null } }] }), null, "retour à l'automatique");
  // Bilan
  const bilan = bilanReprise([META_ANCIEN, null, {}]);
  assert.equal(bilan.find((b) => b.ancienId === "metres").devient, "visite_chiffrage");
  assert.equal(bilan.find((b) => b.ancienId === "reponse_client").devient, null);
});

// ─── 5. Signaux automatiques ────────────────────────────────────────────────
await test("5. phasage créé seulement avec les matériaux prévus, raison affichée", () => {
  assert.equal(etatPhasageMateriaux(null).fait, false);
  assert.match(etatPhasageMateriaux(null).raison, /Aucun phasage/);
  assert.match(etatPhasageMateriaux({ ouvrages: [] }).raison, /aucun ouvrage/);
  const heures = etatPhasageMateriaux({ ouvrages: [{ heures_devis: 10 }, { heures_devis: 4 }] });
  assert.equal(heures.fait, false);
  assert.match(heures.raison, /aucun matériau prévu/);
  const ok = etatPhasageMateriaux({ ouvrages: [{ materiaux_liens: [{ id: 1 }] }, { cout_materiaux: 0 }] });
  assert.equal(ok.fait, true);
  assert.match(ok.raison, /1 sans matériau/);
});

await test("5b. acompte : facture de l'échéance, sinon première facture d'acompte ProGBat ; réglée par les règlements", () => {
  assert.equal(etatAcompteChantier({}).facture, null);
  const f1 = { id: "f1", chantier_id: "c", progbat_type: "advance", montant_ttc: 1200, date_facture: "2026-10-01", progbat_bill_id: 901, source: "progbat" };
  const f2 = { id: "f2", chantier_id: "c", progbat_type: "advance", montant_ttc: 400, date_facture: "2026-10-20", progbat_bill_id: 902, source: "progbat" };
  const annul = { id: "f0", chantier_id: "c", progbat_type: "advance", montant_ttc: 1200, date_facture: "2026-09-01", progbat_situation_number: -900, source: "progbat" };
  let a = etatAcompteChantier({ factures: [f2, f1, annul], reglements: [] });
  assert.equal(a.facture.id, "f1", "la plus ancienne, hors document d'annulation");
  assert.equal(a.choix, "premiere_progbat");
  assert.match(a.raison, /première facture d'acompte ProGBat/);
  assert.equal(a.encaisse, false);
  assert.equal(a.emiseLe, "2026-10-01");
  a = etatAcompteChantier({ factures: [f1, { ...f2, ligne_id: "acompte" }], reglements: [] });
  assert.equal(a.facture.id, "f2", "l'échéance « acompte » prime");
  a = etatAcompteChantier({ factures: [f1], reglements: [{ id: "r", facture_id: "f1", montant: 600 }] });
  assert.equal(a.encaisse, false, "partiellement réglée : pas encaissée");
  a = etatAcompteChantier({ factures: [f1], reglements: [{ id: "r", facture_id: "f1", montant: 1200 }] });
  assert.equal(a.encaisse, true);
  a = etatAcompteChantier({ factures: [{ id: "m", ligne_id: "acompte", statut: "encaissee", source: "manuel", date_facture: "2026-10-02", date_encaissement: "2026-10-09" }] });
  assert.equal(a.encaisse, true);
});

await test("5c. évaluation : un contexte absent n'est jamais un résultat ; coche manuelle d'acompte conservée", () => {
  for (const e of CYCLE_VIE_ETAPES.filter((x) => x.nature === "auto")) {
    const r = evaluerEtape(e, {});
    assert.equal(r.fait, false, `${e.id} sans contexte : pas fait`);
    assert.ok(r.raison && r.raison.length > 5, `${e.id} : raison affichée`);
  }
  const { etats } = etatsEtapesRepris({ meta: META_ANCIEN });
  const r = evaluerEtape(getEtape("acompte_encaisse"), { etatsEtapes: etats, acompte: etatAcompteChantier({}) });
  assert.equal(r.fait, true);
  assert.match(r.raison, /Camille/);
  const pre = evaluerEtape(getEtape("pre_reception"), { groupes: [{ id: "g1" }, { id: "g2" }], controles: [{ groupe_id: "g1", date_controle: "2026-10-01" }] });
  assert.equal(pre.fait, false);
  assert.match(pre.raison, /1\/2/);
  const pre2 = evaluerEtape(getEtape("pre_reception"), { groupes: [{ id: "g1" }], controles: [{ groupe_id: "g1", date_controle: "2026-10-01" }] });
  assert.equal(pre2.fait, true);
  const solde = evaluerEtape(getEtape("facture_solde"), { facturation: { solde: { statut: "emise", raison: "Facture émise" } } });
  assert.equal(solde.fait, true);
  assert.equal(declencheurAtteint({ declencheur: { type: "reception" } }, { etatsEtapes: { reception_pv: { fait: true } } }).atteint, true, "facture de solde déclenchée par « Réception + PV »");
  // La déduction de phase ne dépasse pas 5 phases
  const cv = computeCycleVie({ statutChantier: "termine", ctx: { etatsEtapes: etats } });
  assert.ok(cv.ordre >= 1 && cv.ordre <= 5);
  assert.equal(cv.declaredPhaseId, null);
});

// ─── 6. Étape partagée ──────────────────────────────────────────────────────
await test("6. autorisation partagée : validée via un autre chantier, sans copie ; dé-partage", () => {
  const autres = [
    { chantierId: "b", chantierNom: "T3 - R+1", etat: { fait: true, date: "2026-10-05T09:00:00Z", auteur: "Loris" } },
    { chantierId: "c", chantierNom: "T2", etat: { fait: true, date: "2026-10-09T09:00:00Z" } },
  ];
  const via = autorisationPartagee({ chantierId: "a", etatPropre: null, autres });
  assert.equal(via.fait, true);
  assert.equal(via.via.chantierId, "b", "la première validation");
  assert.match(via.raison, /validée via le chantier T3 - R\+1 le 05\/10\/2026/i);
  const dep = autorisationPartagee({ chantierId: "a", etatPropre: { departage: true }, autres });
  assert.equal(dep.fait, false);
  assert.equal(dep.departage, true);
  const propre = autorisationPartagee({ chantierId: "a", etatPropre: { fait: true, date: "2026-10-01" }, autres });
  assert.equal(propre.via, null);
  assert.equal(autorisationPartagee({ chantierId: "a", autres: [] }).fait, false);
  const ev = evaluerEtape(getEtape("autorisation_recue"), { autorisation: via });
  assert.equal(ev.fait, true);
  assert.equal(ev.via.chantierNom, "T3 - R+1");
});

// ─── 7. Liens uniques ───────────────────────────────────────────────────────
await test("7. module unique des adresses ProGBat (6 adresses, repli, avertissement entreprise)", () => {
  assert.equal(urlDevisProgbat(524), "https://app.progbat.com/v5#/v5/quotes/524", "D-260264 = quotes/524");
  assert.equal(urlFactureProgbat("77"), "https://app.progbat.com/v5#/v5/bills/77");
  assert.equal(urlListeFacturesSurligneeProgbat(77), "https://app.progbat.com/v5#/v5/bills?highlight=77");
  assert.equal(urlListeFacturesProgbat(), "https://app.progbat.com/v5#/v5/bills");
  assert.equal(urlChantierProgbat(2), "https://app.progbat.com/v5#/v5/business/2");
  assert.equal(urlListeClientsProgbat(), "https://app.progbat.com/v5#/v5/thirds/type-2");
  assert.equal(urlDevisProgbat("D-260264"), null, "le numéro affiché n'est pas un identifiant");
  const sans = lienProgbat("devis", null);
  assert.equal(sans.url, null);
  assert.match(sans.raison, /inconnu/);
  const repli = lienProgbat("facture", null);
  assert.equal(repli.repli, true);
  assert.equal(repli.url, urlListeFacturesProgbat());
  assert.ok(lienProgbat("devis", 524).titre.includes("PROFERO RENOVATION"));
  assert.ok(PROGBAT_AVERTISSEMENT_ENTREPRISE.includes("PROFERO RENOVATION"));
  // Aucune autre adresse ProGBat recopiée dans le front
  const dir = join(racine, "src/Renovation");
  for (const f of readdirSync(dir).filter((x) => /\.(jsx?|mjs)$/.test(x) && x !== "progbatLiens.mjs")) {
    assert.ok(!lire(`src/Renovation/${f}`).includes("app.progbat.com"), `${f} : passer par progbatLiens`);
  }
});

await test("7b. Google Agenda : un seul fabricant de liens, utilisé par le Planning et les visites", () => {
  const url = new URL(lienGoogleAgenda({ titre: "Visite avant chiffrage — T2", lieu: "12 rue des Lilas, 49000 Angers" }));
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), "Visite avant chiffrage — T2");
  assert.equal(url.searchParams.get("location"), "12 rue des Lilas, 49000 Angers");
  assert.equal(adresseChantierAgenda({ projet: { chantier_adresse: "1 rue A", chantier_code_postal: "49000", chantier_ville: "Angers" } }).lieu, "1 rue A, 49000 Angers");
  assert.equal(adresseChantierAgenda({}).source, null);
  assert.match(lire("src/Renovation/Planning.jsx"), /lienGoogleAgenda\(/);
  for (const f of ["src/Renovation/Planning.jsx", "src/Renovation/PageChantiers.jsx"]) {
    assert.ok(!lire(f).includes("calendar.google.com"), `${f} : passer par agendaGoogle`);
  }
});

// ─── 8. Relances ────────────────────────────────────────────────────────────
const JOUR = "2026-11-20";
const CA = { id: "u1", nom: "Chargé A", email: "ca@exemple.fr" };
const actif = lireReglagesRelances({ actif: true, delai_jours: 7 });

await test("8. réglages : absent ou illisible = éteint, 7 jours par défaut", () => {
  assert.equal(CLE_REGLAGES_RELANCES, "relances_cycle_vie");
  assert.deepEqual(lireReglagesRelances(null), { actif: false, delaiJours: DELAI_RELANCE_DEFAUT });
  assert.deepEqual(lireReglagesRelances({ actif: "true" }), { actif: false, delaiJours: 7 }, "seul true active");
  assert.equal(lireReglagesRelances({ actif: true, delai_jours: 10 }).delaiJours, 10);
  assert.equal(lireReglagesRelances({ delai_jours: 0 }).delaiJours, 1);
});

await test("8b. décision : J+délai puis chaque semaine, arrêt à la signature, aucune pour un perdu ou sans chargé d'affaires", () => {
  const base = { type: "devis", chantierId: "c", chargeAffaires: CA, journal: [], reglages: actif, todayISO: JOUR };
  assert.equal(decisionRelance({ ...base, reference: null }).statut, "sans_objet");
  assert.equal(decisionRelance({ ...base, reference: "2026-11-15" }).statut, "en_attente");
  assert.match(decisionRelance({ ...base, reference: "2026-11-15" }).raison, /22\/11\/2026/);
  const j7 = decisionRelance({ ...base, reference: "2026-11-13" });
  assert.equal(j7.statut, "a_envoyer");
  assert.equal(j7.periode, 0);
  assert.equal(j7.destinataire, "ca@exemple.fr");
  assert.equal(decisionRelance({ ...base, reference: "2026-11-06" }).periode, 1, "une semaine plus tard");
  assert.equal(decisionRelance({ ...base, reference: "2026-11-13", reglages: lireReglagesRelances({ actif: true, delai_jours: 10 }) }).statut, "en_attente", "délai réglable");
  assert.equal(decisionRelance({ ...base, reference: "2026-11-01", termine: true }).statut, "terminee");
  assert.equal(decisionRelance({ ...base, reference: "2026-11-01", perdu: true }).statut, "perdu");
  const sansCa = decisionRelance({ ...base, reference: "2026-11-01", chargeAffaires: null });
  assert.equal(sansCa.statut, "impossible");
  assert.equal(sansCa.raison, "relance impossible : aucun chargé d'affaires");
  assert.equal(decisionRelance({ ...base, reference: "2026-11-01", chargeAffaires: { id: "u2", nom: "X", email: null } }).statut, "impossible");
  assert.equal(decisionRelance({ ...base, reference: "2026-11-13", reglages: lireReglagesRelances(null) }).statut, "desactivee");
  // Anti-doublon
  const journal = [{ chantier_id: "c", type: "devis", reference: "2026-11-13", periode: 0, statut: "envoyee", envoye_le: "2026-11-20T07:00:00Z" }];
  const deja = decisionRelance({ ...base, reference: "2026-11-13", journal });
  assert.equal(deja.statut, "deja_envoyee");
  assert.equal(deja.nbEnvoyees, 1);
  assert.equal(deja.derniereLe, "2026-11-20");
  assert.equal(decisionRelance({ ...base, reference: "2026-11-13", journal: [{ ...journal[0], statut: "echec" }] }).statut, "a_envoyer", "un échec se retente");
  // Acompte
  const refs = referencesRelances({ etats: {}, acompte: etatAcompteChantier({ factures: [{ id: "f", progbat_type: "advance", montant_ttc: 10, date_facture: "2026-11-01", progbat_bill_id: 5 }] }) });
  assert.equal(refs.acompte.reference, "2026-11-01");
  assert.equal(refs.acompte.billId, 5);
  assert.equal(referencesRelances({ etats: { acompte_encaisse: { fait: true } }, acompte: null }).acompte.termine, true);
  assert.equal(referencesRelances({ etats: { devis_envoye: { fait: true, date: "2026-11-02T10:00:00Z" }, devis_signe: { fait: true } } }).devis.termine, true);
  assert.equal(emailCompte({ email: "x@profero.local" }), null, "identifiant local : pas d'adresse");
  assert.equal(emailCompte({ email: "a@b.fr", actif: false }), null);
});

await test("8c. éteint : le plan d'envoi est TOUJOURS vide ; l'e-mail porte le lien ProGBat", () => {
  const dossiers = [{ chantierId: "c", chantierNom: "T2", perdu: false, chargeAffaires: CA,
    devis: { reference: "2026-11-01", termine: false, quoteId: 524 }, acompte: { reference: null, termine: false } }];
  assert.equal(planifierRelances({ dossiers, journal: [], reglages: lireReglagesRelances(null), todayISO: JOUR }).aEnvoyer.length, 0);
  const plan = planifierRelances({ dossiers, journal: [], reglages: actif, todayISO: JOUR });
  assert.equal(plan.aEnvoyer.length, 1);
  const mail = contenuEmailRelance({ type: "devis", dossier: dossiers[0], periode: 1, lien: lienProgbat("devis", 524), todayISO: JOUR });
  assert.ok(mail.html.includes("https://app.progbat.com/v5#/v5/quotes/524"));
  assert.match(mail.subject, /devis non signé/);
});

// Base simulée en mémoire (aucune base réelle) : enregistre chaque appel.
function baseSimulee(tables) {
  const appels = [];
  const t = JSON.parse(JSON.stringify(tables));
  const corresp = (ligne, filtres) => filtres.every(([op, c, v]) => (op === "eq" ? String(ligne[c]) === String(v) : op === "in" ? v.map(String).includes(String(ligne[c])) : true));
  const from = (table) => {
    const q = { table, filtres: [], action: "select", valeurs: null, plage: null };
    const exec = () => {
      appels.push({ table, action: q.action });
      const lignes = t[table] || (t[table] = []);
      if (q.action === "insert") {
        const v = q.valeurs;
        if (table === "relances_cycle_vie" && lignes.some((l) => l.chantier_id === v.chantier_id && l.type === v.type && l.reference === v.reference && Number(l.periode) === Number(v.periode))) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        lignes.push({ ...v }); return { data: { id: lignes.length }, error: null };
      }
      const touchees = lignes.filter((l) => corresp(l, q.filtres));
      if (q.action === "update") { touchees.forEach((l) => Object.assign(l, q.valeurs)); return { data: touchees, error: null }; }
      let res = touchees;
      if (q.plage) res = res.slice(q.plage[0], q.plage[1] + 1);
      return { data: res, error: null };
    };
    const api = {
      select: () => api, eq: (c, v) => { q.filtres.push(["eq", c, v]); return api; },
      in: (c, v) => { q.filtres.push(["in", c, v]); return api; },
      match: (o) => { Object.entries(o).forEach(([c, v]) => q.filtres.push(["eq", c, v])); return api; },
      range: (a, b) => { q.plage = [a, b]; return api; },
      insert: (v) => { q.action = "insert"; q.valeurs = v; return api; },
      update: (v) => { q.action = "update"; q.valeurs = v; return api; },
      maybeSingle: async () => { const r = exec(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] || null) : r.data }; },
      then: (ok, ko) => Promise.resolve(exec()).then(ok, ko),
    };
    return api;
  };
  return { from, appels, tables: t };
}

// Exemple issu des tests, données fictives.
const TABLES = {
  chantiers: [
    { id: "c1", operation_id: "o1", nom: "T2 - R+2", statut: "a_l_etude", charge_affaires_id: null },
    { id: "c2", operation_id: "o1", nom: "T3 - R+1", statut: "perdu" },
    { id: "c3", operation_id: "o2", nom: "Maison", statut: "a_l_etude" },
  ],
  operations: [{ id: "o1", nom: "Immeuble A", charge_affaires_id: "u1", charge_affaires_nom: "Chargé A" }, { id: "o2", nom: "Maison B" }],
  chantier_cycle_vie: [
    { chantier_id: "c1", etape_id: "devis_envoye", etat: { fait: true, date: "2026-11-10T09:00:00Z" } },
    { chantier_id: "c2", etape_id: "devis_envoye", etat: { fait: true, date: "2026-11-01T09:00:00Z" } },
    { chantier_id: "c3", etape_id: "devis_envoye", etat: { fait: true, date: "2026-11-01T09:00:00Z" } },
  ],
  phasages: [], chantier_factures_client: [], chantier_factures_reglements: [], chantier_projets: [],
  profero_projets: [], utilisateurs: [{ id: "u1", email: "ca@exemple.fr", actif: true }], relances_cycle_vie: [],
};

await test("9. tâche planifiée ÉTEINTE : ne lit que l'interrupteur et n'envoie strictement rien", async () => {
  const { runRelancesCycleVie } = require("../api/_cron/cron-relances-cycle-vie.js");
  for (const valeur of [undefined, { actif: false, delai_jours: 7 }, { actif: "oui" }]) {
    const db = baseSimulee({ ...TABLES, planning_config: valeur === undefined ? [] : [{ key: "relances_cycle_vie", value: valeur }] });
    let envois = 0;
    const r = await runRelancesCycleVie({}, db, { dateIso: JOUR }, async () => { envois++; return { ok: true }; });
    assert.equal(envois, 0, "aucun e-mail");
    assert.equal(r.actif, false);
    assert.deepEqual(db.appels.map((a) => a.table), ["planning_config"], "aucune autre lecture ni écriture");
  }
});

await test("9b. tâche planifiée ALLUMÉE : envoie la relance due au chargé d'affaires, une seule fois", async () => {
  const { runRelancesCycleVie } = require("../api/_cron/cron-relances-cycle-vie.js");
  const db = baseSimulee({ ...TABLES, planning_config: [{ key: "relances_cycle_vie", value: { actif: true, delai_jours: 7 } }] });
  const envoyes = [];
  const envoyer = async (req, to, subject) => { envoyes.push({ to, subject }); return { ok: true }; };
  const r = await runRelancesCycleVie({}, db, { dateIso: JOUR }, envoyer);
  // c1 : envoyé le 10/11, chargé d'affaires de l'opération → relance (J+10).
  // c2 : perdu → rien. c3 : aucun chargé d'affaires → impossible, rien.
  assert.equal(envoyes.length, 1);
  assert.equal(envoyes[0].to, "ca@exemple.fr");
  assert.match(envoyes[0].subject, /Immeuble A › T2 - R\+2/);
  assert.equal(r.envoyees, 1);
  assert.equal(r.par_statut.perdu, 2, "devis et acompte du chantier perdu");
  assert.ok(r.par_statut.impossible >= 1);
  assert.equal(db.tables.relances_cycle_vie.length, 1);
  assert.equal(db.tables.relances_cycle_vie[0].statut, "envoyee");
  const r2 = await runRelancesCycleVie({}, db, { dateIso: JOUR }, envoyer);
  assert.equal(envoyes.length, 1, "même jour : rien de plus");
  assert.equal(r2.envoyees, 0);
  await runRelancesCycleVie({}, db, { dateIso: "2026-11-24" }, envoyer);
  assert.equal(envoyes.length, 2, "la semaine suivante : nouvelle relance");
});

await test("9c. dossiers : mêmes règles que la fiche (chargé d'affaires de l'opération, ancien cycle repris)", () => {
  const d = construireDossiersRelances({
    chantiers: [{ id: "c", operation_id: "o", nom: "T2" }], operations: [{ id: "o", nom: "Op", charge_affaires_id: "u1" }],
    phasages: [{ chantier_id: "c", updated_at: "2026-01-01", plan_travaux: { meta: META_ANCIEN } }],
    utilisateurs: [{ id: "u1", email: "ca@exemple.fr" }],
  });
  assert.equal(d[0].devis.termine, true, "devis signé repris de l'ancien cycle");
  assert.equal(d[0].acompte.termine, true, "coche manuelle d'acompte reprise");
  assert.equal(d[0].chargeAffaires.email, "ca@exemple.fr");
});

// ─── 10. Synthèse d'opération ───────────────────────────────────────────────
await test("10. synthèse d'opération en lecture seule : « 2/3 devis signés », perdus exclus", () => {
  const r = (etats, autorisation = null) => resumeCycleVieChantier({ etats, autorisation });
  const s = syntheseCycleVieOperation([
    { id: "a", resume: r({ devis_envoye: { fait: true }, devis_signe: { fait: true } }) },
    { id: "b", resume: r({ devis_signe: { fait: true }, reception_pv: { fait: true } }, { fait: true, via: { chantierNom: "a" } }) },
    { id: "c", resume: r({}) },
    { id: "d", perdu: true, resume: r({ devis_signe: { fait: true } }) },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.perdus, 1);
  assert.equal(s.lignes.find((l) => l.id === "devis_signe").texte, "2/3 devis signés");
  assert.equal(s.lignes.find((l) => l.id === "reception_pv").texte, "1/3 réceptionnés");
  assert.equal(s.lignes.find((l) => l.id === "autorisation_recue").faits, 1);
  assert.equal(r({ devis_envoye: { fait: true } }).dernier.id, "devis_envoye", "jalon réutilisable (mini-frise)");
});

// ─── 11. Branchements et migration ──────────────────────────────────────────
await test("11. branchements : dispatcher, créneau, écran, pas d'écriture dans l'ancien stockage, pas d'appel ProGBat", () => {
  const disp = lire("api/cron-dispatcher.js");
  assert.match(disp, /relances_cycle_vie:\s*\{\s*fenetre:\s*null/);
  const wf = lire(".github/workflows/cron-dispatcher.yml");
  assert.match(wf, /job=relances_cycle_vie/);
  const page = sansCommentaires(lire("src/Renovation/PageChantiers.jsx"));
  assert.ok(!/CV_META_ETAPES|\[\s*["']cycle_vie_etapes["']\s*\]\s*:/.test(page), "la fiche n'écrit plus meta.cycle_vie_etapes");
  assert.match(page, /ecrireEtapeCycleVie\(/);
  // Lot 4 : le texte d'attente est remplacé par le bouton de la facture d'acompte.
  assert.match(page, /<AcompteProgbat/);
  assert.match(lire("src/Renovation/PageOperations.jsx"), /<SyntheseCycleVieOperation/);
  assert.match(lire("src/Renovation/Admin.jsx"), /<ReglagesRelancesAdmin/);
  for (const f of ["api/_cron/cron-relances-cycle-vie.js", "src/Renovation/cycleVieDonnees.js", "src/Renovation/relancesCycleVie.mjs"]) {
    const s = sansCommentaires(lire(f));
    assert.ok(!/progbat-|functions\.invoke|api\.progbat/i.test(s), `${f} : aucun appel ProGBat`);
  }
  assert.match(lire("src/Renovation/journalMaj.js"), /Cycle de vie du chantier en 5 phases/);
});

await test("12. migration du lot 3 purement additive, policy profero_collaborateurs_seulement sur chaque table", () => {
  const nom = readdirSync(join(racine, "supabase/migrations")).find((f) => /refonte_operations_lot3\.sql$/.test(f));
  assert.ok(nom, "migration versionnée");
  const sql = sansCommentaires(lire(`supabase/migrations/${nom}`)).toLowerCase();
  assert.ok(!/\bdrop\b|\bdelete\s+from\b|\btruncate\b|\bupdate\s+public\.|security\s+definer|alter\s+table\s+public\.(?!chantier_cycle_vie|relances_cycle_vie)/.test(sql), "rien n'est supprimé ni réécrit");
  const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, ["chantier_cycle_vie", "relances_cycle_vie"]);
  for (const t of tables) {
    assert.match(sql, new RegExp(`create policy profero_collaborateurs_seulement on public\\.${t}\\s+as restrictive`), `${t} : policy restrictive`);
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
  }
  assert.ok(!/grant[^;]*delete/.test(sql), "aucun droit de suppression");
  assert.match(sql, /unique \(chantier_id, type, reference, periode\)/, "anti-doublon en base");
  assert.ok(lire("sql/202611_refonte_operations_lot3_rollback.sql").includes("_sauvegarde_refonte"));
});

console.log(`\n${n} vérifications du lot 3 passées.`);
