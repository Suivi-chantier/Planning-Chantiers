// src/Invest/dossiers/repriseDossiers.mjs — Reprise de l'existant en Dossiers
// Invest (Chantier 1.1, Tranche 1).
//
// Module PUR : reçoit un export des données (lignes brutes), rend un PLAN et le
// SQL idempotent qui l'appliquerait. Aucune connexion, aucune horloge, aucun
// hasard (les identifiants viennent de `uuidDepuis`, fourni par l'appelant).
//
// Règles (décisions D1–D5 du 30/09/2026) :
//   - aucune date inventée : une date inconnue reste vide ;
//   - aucun conseiller inventé : rapprochement UNIQUE, sinon vide + signalement ;
//   - aucune mission inventée : un dossier n'est créé que sur une trace de
//     mission (tâches, date de signature, étape client ≥ 2, conversion) ;
//   - aucun JSON historique modifié, aucune donnée supprimée ;
//   - tâches « urbanisme » (et clés inconnues) : étape laissée vide ;
//   - toutes les étapes reprises sont marquées reprise_a_confirmer.

import {
  CLES_ETAPES, POSITIONS_ETAPES_CLIENT, etapeDepuisStepKey, lireEtapeClient,
} from "./parcours.mjs";
import { normaliserCleAnnuaire } from "../annuaire.mjs";

export const AUTEUR_REPRISE = "Reprise Tranche 1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUTS_ACTION_OUVERTE = new Set(["a_faire", "en_cours", "bloque"]);

const norm = (v) => normaliserCleAnnuaire(v);
const nomClient = (c) => [c.prenom, c.nom].filter((x) => String(x || "").trim()).join(" ") || c.id;
const dateIso = (v) => {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Rapprochement d'un nom ou d'un e-mail avec UN utilisateur actif, sinon null. */
export function rapprocherUtilisateur(utilisateurs, { nom, email } = {}) {
  const actifs = utilisateurs.filter((u) => u && u.actif !== false);
  const e = String(email || "").trim().toLowerCase();
  if (e) {
    const parEmail = actifs.filter((u) => String(u.email || "").trim().toLowerCase() === e);
    if (parEmail.length === 1) return { id: parEmail[0].id, par: "email" };
    if (parEmail.length > 1) return { id: null, ambigu: true };
  }
  const cle = norm(nom);
  if (!cle) return { id: null };
  const candidats = actifs.filter((u) => {
    const n = norm(u.nom);
    const local = norm(String(u.email || "").split("@")[0]);
    const cles = new Set([n, n.split(/\s+/)[0], local, local.split(".")[0]].filter(Boolean));
    return cles.has(cle);
  });
  if (candidats.length === 1) return { id: candidats[0].id, par: "nom" };
  return { id: null, ambigu: candidats.length > 1 };
}

function statutClient(s) {
  const t = norm(s);
  if (t === "actif") return "actif";
  if (t === "termine") return "termine";
  if (t === "inactif") return "inactif";
  if (t === "prospect") return "prospect";
  return t ? "inconnu" : "vide";
}

/** Statuts des 11 étapes à partir de l'ancienne position client ou, à défaut, des tâches. */
function etapesProposees(position, actionsParEtape) {
  const statuts = Object.fromEntries(CLES_ETAPES.map((e) => [e, "a_venir"]));
  if (position?.finalise) {
    for (const e of CLES_ETAPES) if (e !== "suivi") statuts[e] = "terminee";
    return { statuts, source: "etape_client_finalise" };
  }
  if (position?.position) {
    const p = POSITIONS_ETAPES_CLIENT[position.position];
    for (const e of p.terminees) statuts[e] = "terminee";
    for (const e of p.en_cours) statuts[e] = "en_cours";
    return { statuts, source: `etape_client_${position.position}`, approximatif: !!p.approximatif };
  }
  for (const [e, s] of actionsParEtape) {
    if (s.ouvertes > 0) statuts[e] = "en_cours";
    else if (s.faites > 0) statuts[e] = "terminee";
  }
  return { statuts, source: "taches" };
}

/**
 * Plan de reprise.
 * @param {{clients:any[], actions:any[], prospects:any[], utilisateurs:any[], dossiers?:any[]}} donnees
 * @param {{uuidDepuis:(texte:string)=>string, arbitrages?:object, exclure?:string[], urbanismeVers?:string|null}} outils
 *   arbitrages : décisions métier par client (identifiant client → décision) :
 *     { inclure, exclure, statut_dossier, motif_cloture, conseiller_id,
 *       lettre: { statut, date }, etapes: { <etape>: <statut> }, motif }
 *     Une décision remplace la déduction automatique et est tracée dans
 *     reprise.arbitrage ; elle n'invente rien : chaque valeur vient de Profero.
 *   exclure : identifiants de clients à ignorer (client de recette…).
 *   urbanismeVers : étape canonique décidée pour les tâches « urbanisme »
 *     (null = laissées à classer, règle A4 par défaut).
 */
export function planifierReprise(donnees, { uuidDepuis, arbitrages = {}, exclure = [], urbanismeVers = null }) {
  const { clients = [], actions = [], prospects = [], utilisateurs = [], dossiers = [] } = donnees;
  const plan = { dossiers: [], etapes: [], actions: [], evenements: [], ignores: [], anomalies: [], urbanisme: [] };
  const signaler = (c, type, detail) => plan.anomalies.push({ client_id: c.id, client: nomClient(c), type, detail });

  const actionsParClient = new Map();
  for (const a of actions) {
    if (!actionsParClient.has(a.client_id)) actionsParClient.set(a.client_id, []);
    actionsParClient.get(a.client_id).push(a);
  }
  const convertisVers = new Map();
  for (const p of prospects) {
    if (!p.converted_client_id) continue;
    if (!convertisVers.has(p.converted_client_id)) convertisVers.set(p.converted_client_id, []);
    convertisVers.get(p.converted_client_id).push(p.id);
  }
  const dejaDossier = new Set(dossiers.map((d) => d.client_id));
  const exclus = new Set(exclure);
  if (urbanismeVers !== null && !CLES_ETAPES.includes(urbanismeVers)) throw new Error(`Étape inconnue : ${urbanismeVers}`);

  for (const c of [...clients].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (!UUID.test(String(c.id))) { plan.ignores.push({ client_id: c.id, client: nomClient(c), raison: "identifiant invalide" }); continue; }
    const arb = arbitrages[c.id] ?? null;
    if (exclus.has(c.id) || arb?.exclure) {
      plan.ignores.push({ client_id: c.id, client: nomClient(c), raison: arb?.motif ? `exclu par arbitrage : ${arb.motif}` : "exclu de la reprise" });
      continue;
    }
    const sesActions = actionsParClient.get(c.id) ?? [];
    const statut = statutClient(c.statut);
    const position = lireEtapeClient(c.etape);
    const dateSignature = dateIso(c.date_signature);
    const prospectsConvertis = convertisVers.get(c.id) ?? [];
    const traces = [];
    if (sesActions.length) traces.push(`${sesActions.length} tâche(s)`);
    if (dateSignature) traces.push("date de signature");
    if (position?.finalise || (position?.position ?? 0) >= 2) traces.push(`étape « ${c.etape} »`);
    if (prospectsConvertis.length) traces.push("conversion d'un prospect");

    if (dejaDossier.has(c.id)) {
      plan.ignores.push({ client_id: c.id, client: nomClient(c), raison: "possède déjà un dossier (reprise déjà faite ou dossier saisi)" });
      continue;
    }
    if ((statut === "prospect" || statut === "vide" || statut === "inconnu") && !arb?.inclure) {
      plan.ignores.push({ client_id: c.id, client: nomClient(c), raison: `statut client « ${c.statut ?? "vide"} »` });
      if (traces.length) signaler(c, "prospect_avec_traces_de_mission", `statut « ${c.statut ?? "vide"} » mais ${traces.join(", ")}`);
      continue;
    }
    if (!traces.length && !arb?.inclure) {
      plan.ignores.push({ client_id: c.id, client: nomClient(c), raison: "aucune trace de mission" });
      signaler(c, "mission_non_identifiable", `statut « ${c.statut} », étape « ${c.etape ?? "vide"} », aucune tâche ni date de signature`);
      continue;
    }

    // ── Dossier ─────────────────────────────────────────────────────────────
    const dossierId = uuidDepuis(`invest-dossier-t1:${c.id}`);
    const conseiller = arb?.conseiller_id ? { id: arb.conseiller_id, par: "arbitrage" } : rapprocherUtilisateur(utilisateurs, { nom: c.conseiller });
    if (!conseiller.id) {
      signaler(c, conseiller.ambigu ? "conseiller_ambigu" : "conseiller_non_reconnu",
        c.conseiller ? `« ${c.conseiller} »` : "aucun conseiller saisi");
    }
    const signatureFaite = sesActions.some((a) => a.step_key === "signature" && a.status === "fait");
    let lettre = "inconnu";
    let dateLettre = dateSignature;
    if (arb?.lettre) {
      lettre = arb.lettre.statut;
      dateLettre = dateIso(arb.lettre.date);
    } else if (dateSignature) lettre = "signee";
    else if (signatureFaite) {
      lettre = "signee";
    }
    if (lettre === "signee" && !dateLettre) signaler(c, "lettre_mission_date_inconnue", arb?.lettre ? "signée (arbitrage), date inconnue" : "tâches Signature faites, date de signature absente");
    if (lettre === "inconnu") signaler(c, "lettre_mission_statut_inconnu", "aucune date ni tâche Signature faite");
    let statutDossier = "actif";
    let motif = null;
    if (statut === "termine") { statutDossier = "clos"; motif = "Reprise : statut client « Terminé »"; }
    if (arb?.statut_dossier) {
      statutDossier = arb.statut_dossier;
      if (["clos", "abandonne"].includes(statutDossier)) motif = arb.motif_cloture ?? motif ?? "Reprise : clôture décidée par Profero";
      else motif = null;
    } else if (statut === "inactif") {
      statutDossier = "suspendu";
      signaler(c, "inactif_a_confirmer", "client « Inactif » repris en dossier suspendu : suspendu ou clos ?");
    }
    if (position?.finalise && statutDossier !== "clos") signaler(c, "finalise_mais_non_termine", `étape « ${c.etape} », statut « ${c.statut} »`);
    if (c.etape && !position) signaler(c, "etape_client_illisible", `« ${c.etape} » : parcours déduit des tâches`);
    if (prospectsConvertis.length > 1) signaler(c, "plusieurs_prospects_convertis", `${prospectsConvertis.length} prospects pointent vers ce client`);

    plan.dossiers.push({
      id: dossierId, client_id: c.id,
      libelle: (lettre === "signee" && dateLettre) ? `Dossier Invest ${dateLettre.slice(0, 4)}` : "Dossier Invest (repris)",
      statut: statutDossier, motif_cloture: motif,
      conseiller_id: conseiller.id ?? null,
      lettre_mission_statut: lettre, lettre_mission_signee_le: lettre === "signee" ? dateLettre : null,
      date_ouverture: lettre === "signee" ? dateLettre : null, // date de signature connue, sinon vide
      origine: "reprise_existant",
      prospect_id: prospectsConvertis[0] ?? null,
      reprise: {
        source: "reprise_tranche1", client_statut: c.statut ?? null, client_etape: c.etape ?? null,
        client_date_signature: c.date_signature ?? null, conseiller_texte: c.conseiller ?? null, traces,
        ...(arb ? { arbitrage: arb } : {}),
      },
      _client: nomClient(c),
    });

    // ── Étapes ──────────────────────────────────────────────────────────────
    const parEtape = new Map();
    for (const a of sesActions) {
      const e = etapeDepuisStepKey(a.step_key);
      if (!e) continue;
      const s = parEtape.get(e) ?? { ouvertes: 0, faites: 0 };
      if (STATUTS_ACTION_OUVERTE.has(a.status)) s.ouvertes += 1; else if (a.status === "fait") s.faites += 1;
      parEtape.set(e, s);
    }
    const { statuts, source, approximatif } = etapesProposees(position, parEtape);
    for (const [e, st] of Object.entries(arb?.etapes ?? {})) {
      if (!CLES_ETAPES.includes(e)) throw new Error(`Arbitrage : étape inconnue ${e}`);
      statuts[e] = st;
    }
    if (approximatif) signaler(c, "correspondance_etape_approximative", `« ${c.etape} » : à confirmer en priorité`);
    const actives = CLES_ETAPES.filter((e) => statuts[e] === "en_cours");
    const derniereActive = actives[actives.length - 1];
    if (statutDossier === "clos" && actives.length) signaler(c, "dossier_clos_avec_etape_active", actives.join(", "));
    for (const e of CLES_ETAPES) {
      const active = statuts[e] === "en_cours";
      const avecAction = e === derniereActive && String(c.prochaine_action || "").trim();
      plan.etapes.push({
        dossier_id: dossierId, etape: e, statut: statuts[e],
        balle: active ? "profero" : null,
        balle_utilisateur_id: active ? conseiller.id ?? null : null,
        prochaine_action: avecAction ? String(c.prochaine_action).trim() : null,
        echeance: avecAction ? dateIso(c.date_prochaine_action) : null,
        reprise_a_confirmer: true,
      });
    }
    // Suggestions (non appliquées) : tâches ouvertes sur une étape « à venir ».
    for (const [e, s] of parEtape) {
      if (s.ouvertes > 0 && statuts[e] === "a_venir") signaler(c, "suggestion_etape_en_cours", `${e} : ${s.ouvertes} tâche(s) ouverte(s)`);
    }

    // ── Tâches ──────────────────────────────────────────────────────────────
    let aClasser = 0;
    for (const a of sesActions) {
      if (!UUID.test(String(a.id))) continue;
      const urba = a.step_key === "urbanisme";
      const etape = a.etape ?? etapeDepuisStepKey(a.step_key) ?? (urba ? urbanismeVers : null);
      if (urba) plan.urbanisme.push({ client: nomClient(c), action_title: a.action_title, status: a.status, etape: etape ?? null });
      if (!etape) aClasser += 1;
      const resp = a.responsable_id ? { id: a.responsable_id } : rapprocherUtilisateur(utilisateurs, { nom: a.responsable, email: a.responsable_email });
      plan.actions.push({
        id: a.id, client_id: c.id, dossier_id: dossierId, etape: etape ?? null,
        responsable_id: resp.id ?? null, responsable_texte: a.responsable ?? null,
        responsable_email: a.responsable_email ?? null, step_key: a.step_key,
      });
    }

    plan.evenements.push({
      dossier_id: dossierId, client_id: c.id,
      resume: `Reprise de l'existant : ${source === "taches" ? "parcours déduit des tâches" : `parcours déduit de « ${c.etape} »`}, `
        + `${sesActions.length} tâche(s) rattachée(s)${aClasser ? `, ${aClasser} à classer` : ""}`
        + `${lettre === "signee" && !dateSignature ? ", date de lettre de mission inconnue" : ""}`
        + `${lettre === "inconnu" ? ", statut de lettre de mission inconnu" : ""}`
        + `${conseiller.id ? "" : ", conseiller non reconnu"}`
        + `${arb ? ", arbitrages Profero appliqués" : ""}. Étapes à confirmer.`,
      apres: { source, traces, taches: sesActions.length, a_classer: aClasser, ...(arb ? { arbitrage: true } : {}) },
    });
  }

  plan.stats = {
    clients: clients.length,
    dossiers: plan.dossiers.length,
    dossiers_par_statut: plan.dossiers.reduce((m, d) => ({ ...m, [d.statut]: (m[d.statut] ?? 0) + 1 }), {}),
    etapes: plan.etapes.length,
    actions_rattachees: plan.actions.length,
    actions_a_classer: plan.actions.filter((a) => !a.etape).length,
    actions_sans_responsable_id: plan.actions.filter((a) => !a.responsable_id).length,
    ignores: plan.ignores.length,
    anomalies: plan.anomalies.length,
  };
  return plan;
}

// ── SQL idempotent ──────────────────────────────────────────────────────────
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const uid = (v) => {
  if (v === null || v === undefined) return "null";
  if (!UUID.test(String(v))) throw new Error(`Identifiant invalide : ${v}`);
  return `'${v}'::uuid`;
};
const jsn = (o) => `${lit(JSON.stringify(o))}::jsonb`;
const dt = (v) => (v ? `${lit(v)}::date` : "null");

/**
 * SQL rejouable : chaque instruction ne s'applique qu'une fois.
 * parGroupes : rattache les tâches par client (et le responsable par groupe
 * client × responsable × e-mail) au lieu de les viser une par une — même
 * résultat, sans dépendre de la liste exhaustive des identifiants de tâches.
 */
export function sqlReprise(plan, { parGroupes = false, urbanismeVers = null } = {}) {
  const l = [
    "-- Reprise Tranche 1 — généré par scripts/reprise-invest-dossiers-t1.mjs. Rejouable.",
    "begin;",
    `select set_config('invest.auteur_libelle', ${lit(AUTEUR_REPRISE)}, true);`,
  ];
  for (const d of plan.dossiers) {
    l.push(`insert into public.invest_dossiers (id, client_id, libelle, statut, motif_cloture, conseiller_id, `
      + `lettre_mission_statut, lettre_mission_signee_le, date_ouverture, origine, prospect_id, reprise) `
      + `select ${uid(d.id)}, ${uid(d.client_id)}, ${lit(d.libelle)}, ${lit(d.statut)}, ${lit(d.motif_cloture)}, `
      + `${uid(d.conseiller_id)}, ${lit(d.lettre_mission_statut)}, ${dt(d.lettre_mission_signee_le)}, `
      + `${dt(d.date_ouverture)}, 'reprise_existant', ${uid(d.prospect_id)}, ${jsn(d.reprise)} `
      + `where not exists (select 1 from public.invest_dossiers x where x.client_id = ${uid(d.client_id)}) `
      + `on conflict (id) do nothing;`);
  }
  for (const e of plan.etapes) {
    l.push(`insert into public.invest_dossier_etapes (dossier_id, etape, statut, balle, balle_utilisateur_id, `
      + `prochaine_action, echeance, reprise_a_confirmer) `
      + `select d.id, ${lit(e.etape)}, ${lit(e.statut)}, ${lit(e.balle)}, ${uid(e.balle_utilisateur_id)}, `
      + `${lit(e.prochaine_action)}, ${dt(e.echeance)}, true from public.invest_dossiers d `
      + `where d.id = ${uid(e.dossier_id)} and d.origine = 'reprise_existant' and not exists (`
      + `select 1 from public.invest_dossier_etapes x where x.dossier_id = d.id and x.etape = ${lit(e.etape)} and x.operation_id is null);`);
  }
  if (parGroupes) {
    for (const d of plan.dossiers) {
      const garde = `client_id = ${uid(d.client_id)}`;
      l.push(`update public.invest_mission_actions set dossier_id = ${uid(d.id)} where ${garde} and dossier_id is null `
        + `and exists (select 1 from public.invest_dossiers x where x.id = ${uid(d.id)});`);
      l.push(`update public.invest_mission_actions set etape = public.invest_etape_depuis_step_key(step_key) `
        + `where ${garde} and etape is null and public.invest_etape_depuis_step_key(step_key) is not null;`);
      if (urbanismeVers) {
        l.push(`update public.invest_mission_actions set etape = ${lit(urbanismeVers)} where ${garde} and etape is null and step_key = 'urbanisme';`);
      }
    }
    const groupes = new Map();
    for (const a of plan.actions) {
      if (!a.responsable_id) continue;
      const cle = JSON.stringify([a.client_id, a.responsable_texte, a.responsable_email]);
      const deja = groupes.get(cle);
      if (deja && deja !== a.responsable_id) throw new Error(`Groupe ambigu : ${cle}`);
      groupes.set(cle, a.responsable_id);
    }
    for (const [cle, rid] of groupes) {
      const [cid, resp, email] = JSON.parse(cle);
      l.push(`update public.invest_mission_actions set responsable_id = ${uid(rid)} where client_id = ${uid(cid)} `
        + `and responsable is not distinct from ${lit(resp)} and responsable_email is not distinct from ${lit(email)} and responsable_id is null;`);
    }
  }
  for (const a of parGroupes ? [] : plan.actions) {
    const garde = `id = ${uid(a.id)} and client_id = ${uid(a.client_id)}`;
    l.push(`update public.invest_mission_actions set dossier_id = ${uid(a.dossier_id)} where ${garde} and dossier_id is null `
      + `and exists (select 1 from public.invest_dossiers d where d.id = ${uid(a.dossier_id)});`);
    if (a.etape) l.push(`update public.invest_mission_actions set etape = ${lit(a.etape)} where ${garde} and etape is null;`);
    if (a.responsable_id) l.push(`update public.invest_mission_actions set responsable_id = ${uid(a.responsable_id)} where ${garde} and responsable_id is null;`);
  }
  for (const ev of plan.evenements) {
    l.push(`insert into public.invest_dossier_evenements (dossier_id, client_id, type, resume, apres, auteur_type, auteur_libelle) `
      + `select ${uid(ev.dossier_id)}, ${uid(ev.client_id)}, 'reprise_importee', ${lit(ev.resume)}, ${jsn(ev.apres)}, 'systeme', ${lit(AUTEUR_REPRISE)} `
      + `where exists (select 1 from public.invest_dossiers d where d.id = ${uid(ev.dossier_id)}) `
      + `and not exists (select 1 from public.invest_dossier_evenements x where x.dossier_id = ${uid(ev.dossier_id)} and x.type = 'reprise_importee');`);
  }
  l.push("commit;");
  return l.join("\n") + "\n";
}

/** Rapport lisible (Markdown) du plan. */
export function rapportReprise(plan, { titre = "Simulation de reprise — Tranche 1" } = {}) {
  const s = plan.stats;
  const lignes = [`# ${titre}`, "",
    `- Clients examinés : ${s.clients}`,
    `- Dossiers à créer : ${s.dossiers} (${Object.entries(s.dossiers_par_statut).map(([k, v]) => `${k} ${v}`).join(", ") || "—"})`,
    `- Étapes à créer : ${s.etapes} (toutes « à confirmer »)`,
    `- Tâches rattachées : ${s.actions_rattachees}, dont ${s.actions_a_classer} à classer, ${s.actions_sans_responsable_id} sans responsable reconnu`,
    `- Clients sans dossier : ${s.ignores}`,
    `- Points à examiner : ${s.anomalies}`, "",
    "## Dossiers proposés", "",
    "| Client | Statut | Lettre de mission | Ouverture | Étape(s) en cours | Traces |", "|---|---|---|---|---|---|"];
  for (const d of plan.dossiers) {
    const enCours = plan.etapes.filter((e) => e.dossier_id === d.id && e.statut === "en_cours").map((e) => e.etape).join(", ") || "—";
    lignes.push(`| ${d._client} | ${d.statut} | ${d.lettre_mission_statut}${d.lettre_mission_signee_le ? ` (${d.lettre_mission_signee_le})` : d.lettre_mission_statut === "signee" ? " (date inconnue)" : ""} | ${d.date_ouverture ?? "inconnue"} | ${enCours} | ${d.reprise.traces.join(", ")} |`);
  }
  lignes.push("", "## Clients sans dossier", "", "| Client | Raison |", "|---|---|");
  for (const i of plan.ignores) lignes.push(`| ${i.client} | ${i.raison} |`);
  lignes.push("", "## Points à examiner", "", "| Client | Type | Détail |", "|---|---|---|");
  for (const a of plan.anomalies) lignes.push(`| ${a.client} | ${a.type} | ${a.detail} |`);
  lignes.push("", `## Tâches urbanisme à classer (${plan.urbanisme.length})`, "", "| Client | Tâche | Statut |", "|---|---|---|");
  for (const u of plan.urbanisme) lignes.push(`| ${u.client} | ${u.action_title} | ${u.status} |`);
  return lignes.join("\n") + "\n";
}
