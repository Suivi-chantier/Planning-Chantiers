#!/usr/bin/env node
// Vérifie la Tranche 2b du Chantier 1.1 : le Dossier Invest est la source de
// vérité du CRM, du tableau de bord / Morning Routine et du mail du matin.
//
//   1. src/Invest/dossiers/pilotage.mjs sur le dossier étalon RECETTE-T2A
//      (exemple issu des tests, données fictives reproduisant l'état final
//      relevé en production le 30/09/2026 : mêmes statuts, balles, dates) ;
//   2. tableauBord.mjs : un client se pilote par son dossier, jamais par
//      invest_clients.etape / prochaine_action ; inconnu ≠ vide ;
//   3. statique : plus d'écriture de l'ancienne étape ni, pour un client
//      suivi par un dossier, de l'ancienne prochaine action.
//
// Aucun réseau, aucune base.   node scripts/verif-invest-pilotage-2b.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as PI from "../src/Invest/dossiers/pilotage.mjs";
import { consolidateData, repartirEnColonnes, emptyRoutine, REQUETES_TABLEAU_BORD, isClientRecord } from "../src/Invest/tableauBord.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const sansCommentaires = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// ── Dossier étalon (exemple issu des tests, données fictives) ─────────────
const AUJ = "2026-09-30";
const U = [{ id: "u-matthieu", nom: "Matthieu Fumoleau", email: "matthieu@test.fr" }, { id: "u-camille", nom: "Camille Landais", email: "camille@test.fr" }];
const CLIENT = { id: "c-t2a", nom: "RECETTE-T2A", prenom: "NE PAS UTILISER", statut: "Actif",
  etape: "13 Signature Notaire", prochaine_action: "ANCIENNE action à ignorer", date_prochaine_action: "2026-01-01" };
const DOSSIER = { id: "d-t2a", client_id: "c-t2a", reference: "INV-2026-0023", libelle: "Dossier RECETTE T2A", statut: "ouvert", conseiller_id: "u-matthieu" };
const e = (etape, statut, extra = {}) => ({ id: `e-${etape}`, dossier_id: "d-t2a", operation_id: null, etape, statut,
  balle: null, balle_utilisateur_id: null, balle_tiers_libelle: null, prochaine_action: null, echeance: null,
  blocage_motif: null, bloquee_depuis: null, reprise_a_confirmer: false, updated_at: `${AUJ}T16:24:38Z`, ...extra });
const ETAPES = [
  e("signature", "en_cours", { balle: "profero", balle_utilisateur_id: "u-matthieu" }),
  e("collecte", "en_cours", { balle: "profero", balle_utilisateur_id: "u-matthieu", prochaine_action: "Relancer le client pour la pièce (recette)", echeance: "2026-10-31" }),
  // Terminée AVEC prochaine action et échéance conservées (historique, point validé 2a).
  e("documents", "terminee", { prochaine_action: "Ancienne action de l'étape terminée", echeance: "2026-09-01" }),
  e("analyse", "en_cours", { balle: "client" }),
  e("strategie", "a_venir", { reprise_a_confirmer: true }),
  e("structuration", "non_applicable"),
  ...["recherche", "opportunites", "financement", "acquisition", "suivi"].map((k) => e(k, "a_venir")),
];
const TACHES = [
  { id: "t1", client_id: "c-t2a", dossier_id: "d-t2a", etape: "collecte", status: "a_faire", due_date: null, action_title: "Reste ouverte" },
  { id: "t2", client_id: "c-t2a", dossier_id: "d-t2a", etape: "collecte", status: "fait", due_date: null, action_title: "Faite" },
  { id: "t3", client_id: "c-t2a", dossier_id: "d-t2a", etape: "documents", status: "non_concerne", due_date: null, action_title: "Non concernée" },
];
const pilotageEtalon = (etapes = ETAPES, taches = TACHES, jour = AUJ) =>
  PI.pilotageDossier({ dossier: DOSSIER, etapes, taches, utilisateurs: U, aujourdhui: jour });

test("1. étalon : plusieurs étapes actives, principale = etapeCourante (Analyse), balles Client et Profero", () => {
  const p = pilotageEtalon();
  assert.deepEqual(p.actives.map((a) => a.etape), ["signature", "collecte", "analyse"], "toutes les étapes actives, dans l'ordre du parcours");
  assert.equal(p.principale.etape, "analyse", "la plus avancée des étapes en cours");
  assert.equal(p.principale.balle.libelle, "Client");
  assert.equal(p.actives[0].balle.libelle, "Profero (Matthieu Fumoleau)");
  assert.equal(p.aConfirmer, 1, "Stratégie encore à confirmer");
  assert.equal(p.tachesOuvertes, 1); assert.deepEqual(p.tachesEnRetard, []);
  assert.equal(p.conseiller, "Matthieu Fumoleau");
  assert.equal(PI.resumePilotage(p), "Analyse · balle Client · Collecte : Relancer le client pour la pièce (recette) · 31/10/2026");
});

test("2. point validé 2a : prochaine action / échéance d'une étape terminée = historique, jamais « à faire »", () => {
  const p = pilotageEtalon();
  assert.equal(p.actives.some((a) => a.etape === "documents"), false);
  const al = PI.alertesPilotage(p);
  assert.ok(!al.some((a) => /Ancienne action|01\/09\/2026/.test(a.label)), al.map((a) => a.label).join(" | "));
  assert.equal(p.prochaineEcheance, "2026-10-31", "seule l'échéance d'une étape active compte");
  // Même la date dépassée (01/09) d'une étape terminée ne crée pas de retard.
  assert.ok(!al.some((a) => a.code.startsWith("echeance_depassee")));
});

test("3. Morning Routine : qui agit, quoi, avant quand", () => {
  const p = pilotageEtalon();
  const ajd = PI.actionDuJour(p);
  // Principale = Analyse (balle Client) ; mais Profero doit agir sur Collecte.
  assert.equal(ajd.etape.etape, "collecte", "l'action vise l'étape où Profero a la balle et une action");
  assert.equal(ajd.responsable, "Matthieu Fumoleau");
  assert.equal(ajd.action, "Relancer le client pour la pièce (recette)");
  assert.equal(ajd.echeance, "2026-10-31", "échéance de CETTE étape, jamais celle d'une autre");
  const seulementAttente = PI.actionDuJour(pilotageEtalon(ETAPES.map((x) => ({ ...x, prochaine_action: null, echeance: null }))));
  assert.equal(seulementAttente.action, "Suivre l'attente : Client (Analyse)", "sans action Profero : suivre l'attente de l'étape principale");
  assert.equal(seulementAttente.echeance, null);
  const al = PI.alertesPilotage(p);
  assert.ok(al.some((a) => a.code === "a_faire_collecte" && a.label === "À faire par Matthieu Fumoleau : Relancer le client pour la pièce (recette) (Collecte)"));
  assert.ok(al.some((a) => a.code === "attente_analyse" && a.level === "info"));
  assert.ok(!al.some((a) => a.code === "sans_prochaine_action"), "Collecte porte une prochaine action");
});

test("4. priorités : échéance dépassée, blocage, tâche en retard, balle Profero sans action", () => {
  const etapes = ETAPES.map((x) => x.etape === "collecte" ? { ...x, echeance: "2026-09-20" }
    : x.etape === "analyse" ? { ...x, statut: "bloquee", balle: "notaire", balle_tiers_libelle: "Étude X", blocage_motif: "Acte manquant", bloquee_depuis: "2026-09-25" } : x);
  const taches = [...TACHES, { id: "t9", dossier_id: "d-t2a", etape: "collecte", status: "a_faire", due_date: "2026-09-10", action_title: "En retard" }];
  const p = pilotageEtalon(etapes, taches);
  const codes = PI.alertesPilotage(p).map((a) => `${a.level}:${a.code}`);
  assert.deepEqual(codes.slice(0, 3), ["danger:echeance_depassee_collecte", "danger:bloquee_analyse", "danger:tache_retard_t9"]);
  assert.equal(p.principale.etape, "analyse", "bloquée prioritaire");
  const sansAction = pilotageEtalon(ETAPES.map((x) => ({ ...x, prochaine_action: null })));
  assert.ok(PI.alertesPilotage(sansAction).some((a) => a.code === "sans_prochaine_action" && a.level === "danger"), "Profero a la balle sans prochaine action");
  const aucune = pilotageEtalon(ETAPES.map((x) => ({ ...x, statut: x.statut === "en_cours" ? "terminee" : x.statut, balle: null })));
  assert.ok(PI.alertesPilotage(aucune).some((a) => a.code === "aucune_etape_active"));
  const proche = pilotageEtalon(ETAPES.map((x) => x.etape === "collecte" ? { ...x, echeance: "2026-10-03" } : x));
  assert.ok(PI.alertesPilotage(proche).some((a) => a.code === "echeance_proche_collecte" && a.level === "warning"));
});

test("5. dossier clos = pas de pilotage ; un seul dossier non clos par client", () => {
  assert.equal(PI.pilotageDossier({ dossier: { ...DOSSIER, statut: "clos" }, etapes: ETAPES, aujourdhui: AUJ }), null);
  const m = PI.indexerPilotage({ dossiers: [{ ...DOSSIER, id: "vieux", statut: "clos" }, DOSSIER], etapes: ETAPES, taches: TACHES, utilisateurs: U, aujourdhui: AUJ });
  assert.equal(m.size, 1); assert.equal(m.get("c-t2a").reference, "INV-2026-0023");
});

test("6. synthèse du tableau de bord", () => {
  const s = PI.syntheseDossiers([pilotageEtalon()]);
  assert.deepEqual(s, { dossiers: 1, etapesActives: 3, dossiersPlusieursEtapes: 1, balles: { profero: 2, client: 1 }, bloques: 0,
    prochainesActions: 1, echeancesDepassees: 0, echeancesProches: 0, tachesEnRetard: 0, sansProchaineAction: 0, aConfirmer: 1 });
});

test("7. projection CRM : l'avancement affiché vient du dossier, l'historique est conservé à part", () => {
  const p = pilotageEtalon();
  const v = PI.projeterClient(CLIENT, p);
  assert.equal(v.etape, "Analyse", "étape principale");
  assert.equal(v.prochaine_action, "Collecte : Relancer le client pour la pièce (recette)", "l'action nomme son étape quand elle diffère");
  assert.equal(v.date_prochaine_action, "2026-10-31");
  assert.equal(v._etapeAction.id, "e-collecte", "les gestes rapides de la liste visent cette étape");
  assert.deepEqual(v._historique, { etape: "13 Signature Notaire", prochaine_action: "ANCIENNE action à ignorer", date_prochaine_action: "2026-01-01" });
  const sans = PI.projeterClient({ ...CLIENT, statut: "Actif" }, null);
  assert.equal(sans.etape, "Sans Dossier Invest en cours"); assert.equal(sans.prochaine_action, null, "client sans dossier : aucune action héritée");
  const prospect = PI.projeterClient({ ...CLIENT, statut: "Prospect" }, null);
  assert.equal(prospect.prochaine_action, "ANCIENNE action à ignorer", "prospect : relance historique conservée");
  const inconnu = PI.projeterClient(CLIENT, null, { inconnu: true });
  assert.equal(inconnu.etape, "Avancement indisponible", "inconnu ≠ « sans dossier »");
});

test("8. tableauBord : le client est piloté par son dossier, jamais par etape / prochaine_action du client", () => {
  const data = consolidateData({ clients: [CLIENT], actions: TACHES, dossiersInvest: [DOSSIER], etapesInvest: ETAPES, utilisateurs: U, jour: AUJ,
    profil: { nom: "Matthieu Fumoleau", email: "matthieu@test.fr" }, pilote: "Matthieu Fumoleau" });
  const d = data.clientDossiers[0];
  assert.equal(d.responsable, "Matthieu Fumoleau");
  assert.equal(d.next_action, "Relancer le client pour la pièce (recette)");
  assert.equal(d.due_date, "2026-10-31");
  assert.equal(d.meta.step, "Analyse", "étape principale affichée");
  assert.equal(d.meta.etapeAction.id, "e-collecte", "l'étape que la décision de routine mettra à jour");
  assert.ok(!JSON.stringify(d.alerts).includes("ANCIENNE"), "ancienne prochaine action ignorée");
  assert.ok(!d.alerts.some((a) => a.code === "no_stage"), "plus d'alerte « étape client non renseignée »");
  assert.equal(data.suiviInvest.dossiers, 1);
  assert.equal(data.prospectDossiers.length, 0);
  // Même client, ancienne étape vide : rien ne change.
  const bis = consolidateData({ clients: [{ ...CLIENT, etape: null, prochaine_action: null }], actions: TACHES, dossiersInvest: [DOSSIER], etapesInvest: ETAPES, utilisateurs: U, jour: AUJ, pilote: "x" });
  assert.equal(bis.clientDossiers[0].next_action, d.next_action);
});

test("9. inconnu ≠ vide : dossiers non chargés → avancement indisponible, jamais « sans dossier »", () => {
  const inconnu = consolidateData({ clients: [CLIENT], jour: AUJ, pilote: "x" });
  assert.equal(inconnu.avancementInconnu, true);
  assert.equal(inconnu.clientDossiers[0].alerts[0].code, "avancement_inconnu");
  const vide = consolidateData({ clients: [CLIENT], dossiersInvest: [], etapesInvest: [], jour: AUJ, pilote: "x" });
  assert.equal(vide.clientDossiers[0].alerts[0].code, "sans_dossier_invest");
  assert.equal(vide.clientDossiers[0].level, "danger", "client Actif sans dossier : à traiter");
  const req = Object.fromEntries(REQUETES_TABLEAU_BORD.map((r) => [r.cle, r]));
  assert.ok(req.dossiersInvest.inconnuSiErreur && req.etapesInvest.inconnuSiErreur);
  assert.equal(isClientRecord({ id: "x", statut: "", etape: "5 Présentation" }), false, "l'ancienne étape ne fait plus d'une ligne un client");
  assert.equal(isClientRecord({ id: "x", statut: "Prospect" }, true), true, "un dossier en cours suffit");
});

test("10. Morning Routine : urgent chez moi → à décider ; attente d'un tiers confiée à Camille → délégué", () => {
  const retard = ETAPES.map((x) => x.etape === "collecte" ? { ...x, echeance: "2026-09-15" } : x);
  const dossier2 = { ...DOSSIER, id: "d2", client_id: "c2", reference: "INV-2", conseiller_id: "u-camille" };
  const etapes2 = [{ ...ETAPES[0], id: "x1", dossier_id: "d2", etape: "financement", balle: "banque", balle_utilisateur_id: null, balle_tiers_libelle: "Banque A", echeance: "2026-10-10" }];
  const data = consolidateData({ clients: [CLIENT, { id: "c2", nom: "Deux", statut: "Actif" }], dossiersInvest: [DOSSIER, dossier2], etapesInvest: [...retard, ...etapes2],
    utilisateurs: U, jour: AUJ, profil: { nom: "Matthieu Fumoleau", email: "matthieu@test.fr" }, pilote: "Matthieu Fumoleau" });
  const col = repartirEnColonnes({ dossiers: data.allDossiers, routine: emptyRoutine(), filtre: "client" });
  assert.deepEqual(col.decision.map((d) => d.id), ["c-t2a"]);
  assert.deepEqual(col.delegated.map((d) => d.id), ["c2"]);
  assert.equal(col.delegated[0].responsable, "Camille Landais", "balle Banque : la conseillère suit l'attente");
});

// ── Statique : écritures legacy ─────────────────────────────────────────────
const CRM = sansCommentaires(lire("src/Invest/CRM.jsx"));
const DASH = sansCommentaires(lire("src/Invest/Dashboard.jsx"));
const TB = sansCommentaires(lire("src/Invest/tableauBord.mjs"));

test("11. plus aucune écriture de invest_clients.etape / etape_num (CRM, Dashboard, Prospection, Structuration)", () => {
  for (const f of ["src/Invest/CRM.jsx", "src/Invest/Dashboard.jsx", "src/Invest/Prospection.jsx", "src/Invest/Structuration.jsx"]) {
    const src = sansCommentaires(lire(f));
    assert.ok(!/\betape_num\b/.test(src), `${f} : etape_num`);
    assert.ok(!/\betape\s*:\s*["'`]\d/.test(src), `${f} : écriture d'une ancienne étape numérotée`);
  }
  assert.ok(!/updateClientPatch\(\{\s*etape/.test(CRM));
  assert.ok(!/select\("\*, client:invest_clients\(id,nom,prenom,statut,etape\)"\)/.test(TB), "le tableau de bord ne lit plus l'ancienne étape");
});

test("12. décisions et gestes rapides : l'étape principale du dossier, pas l'ancienne prochaine action", () => {
  const apply = DASH.slice(DASH.indexOf("const applyEntityUpdate"), DASH.indexOf("const saveDecision"));
  const branche = apply.slice(apply.indexOf('item.type === "client"'), apply.indexOf('item.type === "bien"'));
  assert.match(branche, /from\("invest_dossier_etapes"\)[\s\S]*update\(\{ prochaine_action:d\.next_action \|\| null, echeance:d\.due_date \|\| null \}\)/);
  assert.ok(!/invest_clients/.test(branche), "la décision client n'écrit plus invest_clients");
  const tache = DASH.slice(DASH.indexOf("const createMissionAction"), DASH.indexOf("const applyEntityUpdate"));
  assert.match(tache, /champsNouvelleTache\(pil\.dossierId, etape\)/, "tâche de routine : dossier + étape + step_key");
  const maj = CRM.slice(CRM.indexOf("const majActionPilotage"), CRM.indexOf("const saveTimelineDraft"));
  assert.match(maj, /from\("invest_dossier_etapes"\)\.update\(patch\)\.eq\("id", e\.id\)/);
  const sync = CRM.slice(CRM.indexOf("const syncNextAction"), CRM.indexOf("return (", CRM.indexOf("const syncNextAction")));
  assert.ok(!/invest_clients/.test(sync), "Parcours Mission : plus d'écriture de l'ancienne prochaine action");
  assert.match(CRM, /dossierInfo\?\.dossierEnCoursId \? \(/, "fiche : ancienne prochaine action en lecture seule quand un dossier est en cours");
});

test("13. CRM : la frise suit les 11 étapes du dossier (plus les 13 anciennes étapes)", () => {
  assert.match(CRM, /\.\.\.ETAPES_PARCOURS\.map\(e => \(\{ n:e\.numero/);
  assert.ok(!/Signature Notaire", short:"Notaire"/.test(CRM), "ancienne frise retirée");
  assert.match(CRM, /projeterClient\(c, pilotagesParClient\?\.get\(c\.id\) \|\| null, \{ inconnu:!pilotagesParClient \}\)/);
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try { await fn(); console.log(`  ✓ ${nom}`); }
  catch (err) { echecs++; console.log(`  ✗ ${nom}\n      ${err.message}`); }
}
console.log(`\n${cas.length - echecs}/${cas.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
