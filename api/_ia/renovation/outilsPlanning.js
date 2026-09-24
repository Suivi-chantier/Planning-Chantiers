// api/_ia/renovation/outilsPlanning.js — Outils en LECTURE SEULE de l'assistant
// planning (Chantier 10, étape 2), exposés par la tâche
// renovation_planning_consigne.
//
// Même contrat que outils.js : { nom, description, schema, executer(params, ctx) }
// avec ctx.sb = adaptateur de lecture (donnees.js), fourni par le serveur.
//
// AUCUN CALCUL ET AUCUNE LECTURE DE STRUCTURE ICI : ce fichier charge des lignes,
// appelle src/Renovation/assistantPlanningConsigneV1.mjs, et met en forme. Les
// règles (recherche d'une personne, lots et tâches d'un chantier, lignes d'un
// jour du planning) vivent dans le module pur, partagé avec le navigateur.
//
// AUCUNE ÉCRITURE : l'enregistrement d'une consigne se fait dans le navigateur,
// avec le compte de l'administrateur connecté, après sa validation explicite.

const { parNom: outilsRenovation } = require("./outils");

const MAX_TACHES = 25;
const MAX_CHANTIERS = 12;

let _module = null;
async function consigne() {
  if (!_module) _module = await import("../../../src/Renovation/assistantPlanningConsigneV1.mjs");
  return _module;
}

const str = (v) => (v == null ? "" : String(v).trim());

function items(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

async function lire(requete, libelle) {
  const { data, error } = await requete;
  if (error) throw new Error(`${libelle} : ${error.message}`);
  return data || [];
}

async function chargerConfig(sb) {
  const lignes = await lire(
    sb.from("planning_config").select("key, value").in("key", ["chantiers", "groupes_types", "equipes"]),
    "planning_config"
  );
  const parCle = new Map(lignes.map((l) => [l.key, l.value]));
  return {
    chantiers: items(parCle.get("chantiers")),
    groupesTypes: items(parCle.get("groupes_types")),
    equipes: items(parCle.get("equipes")),
  };
}

async function chargerRessources(sb) {
  return lire(sb.from("planning_resources").select("id, nom, nom_planning, kind, actif"), "planning_resources");
}

async function chargerPhasages(sb, chantierId) {
  let q = sb.from("phasages").select("chantier_id, ouvrages, plan_travaux");
  if (chantierId) q = q.eq("chantier_id", chantierId);
  return lire(q, "phasages");
}

async function chargerInterventions(sb, date, chantierId) {
  const m = await consigne();
  const cible = m.celluleDuJourV1(date);
  if (!cible) return [];
  let q = sb.from("planning_cells").select("chantier_id, week_id, jour, ouvriers, taches")
    .eq("week_id", cible.week_id).eq("jour", cible.jour);
  if (chantierId) q = q.eq("chantier_id", chantierId);
  const cellules = await lire(q, "planning_cells");
  const verrous = await lire(
    sb.from("planning_constraints").select("allocation_id").eq("type", "allocation_lock").eq("actif", true),
    "planning_constraints"
  );
  return m.interventionsDuJourV1({ cellules, date, chantierId, verrous });
}

/**
 * Référentiel complet pour valider UNE consigne (serveur). Mêmes champs que
 * ceux que le navigateur charge avant d'écrire.
 */
async function chargerReferentielConsigne(sb, consigneProposee = {}) {
  const chantierId = str(consigneProposee.chantier_id) || null;
  const [config, ressources, contraintes, evenements] = await Promise.all([
    chargerConfig(sb),
    chargerRessources(sb),
    lire(sb.from("planning_constraints").select("id, type, scope, chantier_id, groupe_type_id, tache_id, allocation_id, source, actif").eq("actif", true), "planning_constraints"),
    lire(sb.from("planning_resource_events").select("id, resource_id, type, date_debut, date_fin, toute_journee, source, actif").eq("actif", true), "planning_resource_events"),
  ]);
  const phasages = chantierId ? await chargerPhasages(sb, chantierId) : [];
  let interventions = [];
  if (str(consigneProposee.nature) === "intervention_verrouillee") {
    const date = str(consigneProposee.date);
    if (date) interventions = await chargerInterventions(sb, date, null);
  }
  return {
    ressources,
    chantiers: config.chantiers,
    groupesTypes: config.groupesTypes,
    equipes: config.equipes,
    phasages,
    interventions,
    evenements,
    contraintes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

const chercher_ressource = {
  nom: "chercher_ressource",
  description:
    "Retrouve une personne planifiable (salarié Profero actif) par son nom tel que l'utilisateur l'écrit. " +
    "Renvoie son identifiant. Si plusieurs personnes correspondent, NE PAS choisir : poser la question. " +
    "Si aucune ne correspond, le dire (la liste complète des noms est renvoyée pour aider).",
  schema: {
    type: "object",
    properties: { texte: { type: "string", description: "Nom ou prénom tel qu'écrit par l'utilisateur." } },
    required: ["texte"],
  },
  async executer(params, ctx) {
    const m = await consigne();
    const r = m.chercherRessourcesV1(await chargerRessources(ctx.sb), params.texte);
    return {
      type: "recherche_ressource",
      texte: r.texte,
      nb: r.trouvees.length,
      ambigu: r.ambigu,
      inconnu: r.inconnu,
      personnes: r.trouvees,
      toutes_les_personnes: r.inconnu ? r.toutes : undefined,
      consigne: r.inconnu
        ? "Aucune personne ne porte ce nom : le dire à l'utilisateur, sans en choisir une autre."
        : r.ambigu ? "Plusieurs personnes correspondent : poser la question avec ces choix." : null,
    };
  },
};

const travaux_chantier = {
  nom: "travaux_chantier",
  description:
    "Lots (groupes de travaux) et tâches ENCORE OUVERTES d'un chantier, filtrés par un texte (ex. « ossature placo »). " +
    "Sans chantier_id, cherche ces travaux sur tous les chantiers en cours et renvoie les chantiers concernés : " +
    "sert à proposer des choix quand l'utilisateur dit « ce chantier » sans le nommer. " +
    "Renvoie aussi l'équipe habituelle de chaque lot.",
  schema: {
    type: "object",
    properties: {
      chantier_id: { type: "string", description: "Identifiant exact (champ id de chercher_chantier). Facultatif." },
      texte: { type: "string", description: "Travaux cherchés, tels qu'écrits par l'utilisateur." },
    },
    required: ["texte"],
  },
  async executer(params, ctx) {
    const m = await consigne();
    const chantierId = str(params.chantier_id) || null;
    const [config, phasages] = await Promise.all([chargerConfig(ctx.sb), chargerPhasages(ctx.sb, chantierId)]);
    const actifs = new Map(config.chantiers.filter((c) => c && str(c.id) && str(c.statut) !== "termine").map((c) => [str(c.id), c]));
    const equipes = new Map(config.equipes.filter((e) => str(e && e.id)).map((e) => [str(e.id), e]));
    const lotsParId = new Map(config.groupesTypes.filter((g) => str(g && g.id)).map((g) => [str(g.id), g]));
    const resultats = phasages
      .filter((ph) => actifs.has(str(ph.chantier_id)))
      .map((ph) => m.travauxDuChantierV1({ phasage: ph, groupesTypes: config.groupesTypes, texte: params.texte }))
      .filter((r) => r.lots.length || r.travaux.length)
      .map((r) => ({
        chantier_id: r.chantier_id,
        chantier: str(actifs.get(r.chantier_id).nom) || r.chantier_id,
        lots: r.lots.map((l) => {
          const eq = equipes.get(str(lotsParId.get(l.groupe_type_id) && lotsParId.get(l.groupe_type_id).equipe_id));
          return { ...l, equipe: eq ? str(eq.nom) || str(eq.id) : null };
        }),
        taches: r.travaux.slice(0, MAX_TACHES),
        taches_tronquees: r.travaux.length > MAX_TACHES,
      }));
    return {
      type: "travaux_chantier",
      texte: str(params.texte),
      chantier_id: chantierId,
      nb_chantiers: resultats.length,
      chantiers: resultats.slice(0, MAX_CHANTIERS),
      consigne: resultats.length === 0
        ? "Aucun lot ni aucune tâche ouverte ne correspond : le dire, sans deviner."
        : !chantierId && resultats.length > 1
          ? "Plusieurs chantiers ont ces travaux : demander lequel, en proposant ces chantiers comme choix."
          : null,
    };
  },
};

const interventions_du_jour = {
  nom: "interventions_du_jour",
  description:
    "Lignes du planning (interventions déjà posées) à une date donnée, avec leur identifiant allocation_uid, " +
    "le chantier, la tâche liée éventuelle, les personnes, la durée et si elles sont déjà verrouillées. " +
    "À utiliser pour « j'ai programmé une intervention le … » : on verrouille une intervention EXISTANTE.",
  schema: {
    type: "object",
    properties: {
      date: { type: "string", description: "Date AAAA-MM-JJ, lue dans le calendrier fourni." },
      chantier_id: { type: "string", description: "Identifiant exact du chantier. Facultatif." },
    },
    required: ["date"],
  },
  async executer(params, ctx) {
    const m = await consigne();
    const date = m.dateISOv1(params.date);
    if (!date) return { type: "interventions_du_jour", date: str(params.date), interventions: [], consigne: "Date illisible : redemander la date." };
    const [config, liste] = await Promise.all([chargerConfig(ctx.sb), chargerInterventions(ctx.sb, date, str(params.chantier_id) || null)]);
    const noms = new Map(config.chantiers.filter((c) => str(c && c.id)).map((c) => [str(c.id), str(c.nom) || str(c.id)]));
    return {
      type: "interventions_du_jour",
      date,
      libelle_date: m.libelleDateV1(date),
      interventions: liste.map((i) => ({ ...i, chantier: noms.get(i.chantier_id) || i.chantier_id })),
      consigne: liste.length === 0
        ? "Aucune intervention n'est posée ce jour-là : demander à l'utilisateur de la placer d'abord dans le planning (page Planning semaine), puis de redemander."
        : null,
    };
  },
};

const OUTILS_PLANNING = [outilsRenovation.chercher_chantier, chercher_ressource, travaux_chantier, interventions_du_jour];

module.exports = {
  OUTILS_PLANNING,
  parNomPlanning: Object.fromEntries(OUTILS_PLANNING.map((o) => [o.nom, o])),
  chargerReferentielConsigne,
  consigne,
};
