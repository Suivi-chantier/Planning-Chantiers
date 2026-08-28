// ─── PLANNING RESOURCES MODEL V1 ─────────────────────────────────────────────
// Modèle métier pur du chantier 02 « Ressources & contraintes ».
// Aucune lecture/écriture Supabase ici.
//
// Principes :
// - une ressource planifiable possède son propre id stable ;
// - le compte `utilisateurs` est un lien optionnel, pas l'identité métier ;
// - `nom_planning` assure la compatibilité avec les historiques encore en texte ;
// - la capacité de base est fournie par `rythmeSemaine` par l'appelant ;
// - le calendrier ne stocke que des EXCEPTIONS à cette capacité ;
// - équipe / préférence ≠ disponibilité réelle.

export const RESOURCE_MODEL_VERSION = 1;

export const RESOURCE_KINDS = Object.freeze({
  PERSONNE: "personne",
  PRESTATAIRE: "prestataire",
});

export const RESOURCE_EVENT_TYPES = Object.freeze({
  ABSENCE: "absence",
  INDISPONIBILITE: "indisponibilite",
  CAPACITE_OVERRIDE: "capacite_override",
});

export const RESOURCE_EVENT_SOURCES = Object.freeze({
  MANUEL: "manuel",
  PAIE: "paie",
  ASSISTANT: "assistant",
  IMPORT: "import",
});

const str = v => String(v ?? "").trim();
const num = v => {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normaliserNomRessource(v) {
  return str(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ");
}

export function normaliserRessource(resource) {
  const r = resource && typeof resource === "object" ? resource : {};
  const kind = Object.values(RESOURCE_KINDS).includes(r.kind)
    ? r.kind
    : RESOURCE_KINDS.PERSONNE;
  const capaciteFacteur = num(r.capacite_facteur);
  return {
    ...r,
    id: str(r.id) || null,
    nom: str(r.nom || r.nom_planning),
    nom_planning: str(r.nom_planning || r.nom),
    utilisateur_id: str(r.utilisateur_id) || null,
    kind,
    actif: r.actif !== false,
    capacite_facteur: capaciteFacteur == null ? 1 : Math.max(0, capaciteFacteur),
  };
}

export function maturiteRessource(resource) {
  const r = normaliserRessource(resource);
  const erreurs = [];
  const warnings = [];
  if (!r.id) erreurs.push("Identifiant stable manquant");
  if (!r.nom) erreurs.push("Nom de ressource manquant");
  if (r.kind === RESOURCE_KINDS.PERSONNE && !r.nom_planning) {
    erreurs.push("Nom planning manquant pour une personne");
  }
  if (!r.utilisateur_id && r.kind === RESOURCE_KINDS.PERSONNE) {
    warnings.push("Aucun compte utilisateur lié — la ressource reste planifiable");
  }
  if (r.capacite_facteur > 1) {
    warnings.push("Capacité supérieure à 100 % — vérifier qu'il ne s'agit pas d'une équipe ou d'un prestataire");
  }
  return { valide: erreurs.length === 0, erreurs, warnings, resource: r };
}

export function trouverUtilisateurPourNomPlanning(nomPlanning, utilisateurs = []) {
  const cle = normaliserNomRessource(nomPlanning);
  if (!cle) return { utilisateur: null, ambigu: false, candidats: [] };
  const candidats = (Array.isArray(utilisateurs) ? utilisateurs : [])
    .filter(u => normaliserNomRessource(u?.prenom_planning) === cle);
  return {
    utilisateur: candidats.length === 1 ? candidats[0] : null,
    ambigu: candidats.length > 1,
    candidats,
  };
}

// Audit de préparation d'une migration depuis la liste texte actuelle.
// Ne génère volontairement AUCUN id : les ids stables seront créés lors de la
// persistance afin de ne jamais confondre une clé de migration avec l'identité.
export function auditerRessourcesLegacy({ ouvriers = [], utilisateurs = [], equipes = [] } = {}) {
  const noms = [...new Set((Array.isArray(ouvriers) ? ouvriers : [])
    .map(str)
    .filter(Boolean))];
  const nomsExternes = new Set();
  for (const eq of Array.isArray(equipes) ? equipes : []) {
    if (!eq?.externe) continue;
    // Le pseudo-ouvrier « Externe » est un artefact historique possible ; on
    // le signale mais on ne le transforme pas automatiquement en personne.
    const eqNom = normaliserNomRessource(eq.nom);
    if (eqNom) nomsExternes.add(eqNom);
  }

  const rows = noms.map(nom => {
    const match = trouverUtilisateurPourNomPlanning(nom, utilisateurs);
    const pseudoExterne = normaliserNomRessource(nom) === "externe" || nomsExternes.has(normaliserNomRessource(nom));
    return {
      nom_planning: nom,
      utilisateur_id: match.utilisateur?.id || null,
      utilisateur_actif: match.utilisateur?.actif ?? null,
      compte_ambigu: match.ambigu,
      pseudo_externe: pseudoExterne,
      proposition_kind: pseudoExterne ? RESOURCE_KINDS.PRESTATAIRE : RESOURCE_KINDS.PERSONNE,
    };
  });

  const warnings = [];
  rows.filter(r => r.compte_ambigu).forEach(r => warnings.push(`Plusieurs comptes correspondent à ${r.nom_planning}`));
  rows.filter(r => r.pseudo_externe).forEach(r => warnings.push(`${r.nom_planning} ressemble à une pseudo-ressource externe : ne pas la migrer comme salarié interne`));
  return { rows, warnings };
}

export function normaliserEquipeLegacy(equipe, ressources = []) {
  const eq = equipe && typeof equipe === "object" ? equipe : {};
  const byName = new Map((Array.isArray(ressources) ? ressources : [])
    .map(normaliserRessource)
    .filter(r => r.nom_planning)
    .map(r => [normaliserNomRessource(r.nom_planning), r]));

  const responsableNom = str(eq.responsable);
  const responsable = responsableNom ? byName.get(normaliserNomRessource(responsableNom)) : null;
  const membres = (Array.isArray(eq.membres) ? eq.membres : [])
    .map(m => {
      const nom = str(m?.ouvrier);
      const res = nom ? byName.get(normaliserNomRessource(nom)) : null;
      return {
        resource_id: res?.id || null,
        nom_planning: nom || null,
        date_dispo: str(m?.date_dispo) || null,
      };
    });

  // Le responsable fait partie de l'effectif. On le garde séparé pour son rôle,
  // mais `resource_ids` contient responsable + membres sans doublon.
  const resourceIds = [responsable?.id, ...membres.map(m => m.resource_id)].filter(Boolean);
  return {
    id: str(eq.id) || null,
    nom: str(eq.nom),
    externe: !!eq.externe,
    responsable_resource_id: responsable?.id || null,
    responsable_nom_planning: responsableNom || null,
    membres,
    resource_ids: [...new Set(resourceIds)],
  };
}

export function membresEquipeDisponibles(equipe, dateISO, ressources = []) {
  const eq = normaliserEquipeLegacy(equipe, ressources);
  if (eq.externe) return [];
  const date = str(dateISO).slice(0, 10);
  const ids = new Set();
  if (eq.responsable_resource_id) ids.add(eq.responsable_resource_id);
  for (const m of eq.membres) {
    if (!m.resource_id) continue;
    if (m.date_dispo && date && m.date_dispo.slice(0, 10) > date) continue;
    ids.add(m.resource_id);
  }
  const byId = new Map((Array.isArray(ressources) ? ressources : []).map(r => {
    const n = normaliserRessource(r);
    return [n.id, n];
  }));
  return [...ids].map(id => byId.get(id)).filter(r => r?.actif !== false);
}

export function ressourcesPrefereesPourGroupe({ groupeType, equipe, dateISO, ressources = [] } = {}) {
  const disponiblesEquipe = membresEquipeDisponibles(equipe, dateISO, ressources);
  const prios = Array.isArray(groupeType?.ouvriers_prio)
    ? groupeType.ouvriers_prio.map(normaliserNomRessource).filter(Boolean)
    : [];
  if (prios.length === 0) return disponiblesEquipe;
  const set = new Set(prios);
  return disponiblesEquipe.filter(r => set.has(normaliserNomRessource(r.nom_planning)));
}

export function normaliserEvenementRessource(event) {
  const e = event && typeof event === "object" ? event : {};
  const type = Object.values(RESOURCE_EVENT_TYPES).includes(e.type) ? e.type : null;
  const dateDebut = str(e.date_debut || e.date).slice(0, 10);
  const dateFin = str(e.date_fin || e.date_debut || e.date).slice(0, 10);
  return {
    ...e,
    id: str(e.id) || null,
    resource_id: str(e.resource_id) || null,
    type,
    date_debut: dateDebut || null,
    date_fin: dateFin || dateDebut || null,
    toute_journee: e.toute_journee !== false,
    heures_indisponibles: num(e.heures_indisponibles),
    capacite_heures: num(e.capacite_heures),
    motif: str(e.motif) || null,
    source: Object.values(RESOURCE_EVENT_SOURCES).includes(e.source) ? e.source : RESOURCE_EVENT_SOURCES.MANUEL,
    actif: e.actif !== false,
  };
}

export function evenementCouvreDate(event, dateISO) {
  const e = normaliserEvenementRessource(event);
  const d = str(dateISO).slice(0, 10);
  if (!e.actif || !e.date_debut || !d) return false;
  return d >= e.date_debut && d <= (e.date_fin || e.date_debut);
}

export function calculerCapaciteRessource({ resource, dateISO, capaciteBase, evenements = [], heuresDejaAllouees = 0 } = {}) {
  const r = normaliserRessource(resource);
  const warnings = [];
  const reasons = [];
  let base = Math.max(0, num(capaciteBase) ?? 0) * r.capacite_facteur;
  let capacite = base;
  let hardUnavailable = !r.actif;

  if (!r.actif) reasons.push({ type: "ressource_inactive", impact_heures: -base, explication: "Ressource inactive" });

  const actifs = (Array.isArray(evenements) ? evenements : [])
    .map(normaliserEvenementRessource)
    .filter(e => e.resource_id === r.id && evenementCouvreDate(e, dateISO));

  const overrides = actifs.filter(e => e.type === RESOURCE_EVENT_TYPES.CAPACITE_OVERRIDE && e.capacite_heures != null);
  if (overrides.length > 1) warnings.push("Plusieurs overrides de capacité couvrent la même date ; la valeur la plus restrictive est appliquée");
  if (overrides.length) {
    const override = Math.min(...overrides.map(e => Math.max(0, e.capacite_heures)));
    capacite = override;
    reasons.push({ type: "capacite_override", capacite_heures: override, explication: "Capacité exceptionnelle définie pour cette date" });
  }

  for (const e of actifs.filter(e => e.type === RESOURCE_EVENT_TYPES.ABSENCE || e.type === RESOURCE_EVENT_TYPES.INDISPONIBILITE)) {
    const fullDay = e.toute_journee && e.heures_indisponibles == null;
    if (fullDay) {
      if (capacite > 0) reasons.push({ type: e.type, impact_heures: -capacite, motif: e.motif, explication: "Indisponibilité sur toute la journée" });
      capacite = 0;
      hardUnavailable = true;
      continue;
    }
    const reduction = Math.max(0, e.heures_indisponibles ?? 0);
    const before = capacite;
    capacite = Math.max(0, capacite - reduction);
    reasons.push({ type: e.type, impact_heures: capacite - before, motif: e.motif, explication: "Indisponibilité partielle" });
  }

  if (hardUnavailable) capacite = 0;
  const allouees = Math.max(0, num(heuresDejaAllouees) ?? 0);
  const disponible = Math.max(0, capacite - allouees);
  if (allouees > capacite + 0.001) warnings.push(`Surcharge : ${allouees} h allouées pour ${capacite} h de capacité`);

  return {
    resource_id: r.id,
    date: str(dateISO).slice(0, 10) || null,
    capacite_base: Number(base.toFixed(2)),
    capacite_apres_exceptions: Number(capacite.toFixed(2)),
    heures_deja_allouees: Number(allouees.toFixed(2)),
    capacite_disponible: Number(disponible.toFixed(2)),
    indisponible: hardUnavailable || capacite <= 0,
    reasons,
    warnings,
    explication: {
      formule: "capacité disponible = capacité rythme × facteur ressource, modifiée par les exceptions, puis diminuée des heures déjà allouées",
      source_capacite_base: "rythmeSemaine",
      evenements_appliques: actifs.map(e => e.id || e.type),
    },
  };
}
