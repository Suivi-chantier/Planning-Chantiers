// ─── ASSISTANT PLANNING — CONSIGNE STRUCTURÉE V1 (chantier 10, étape 2) ─────
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// Les données arrivent en paramètre ; « aujourd'hui » aussi.
//
// Rôle : transformer la proposition renvoyée par la tâche IA
// `renovation_planning_consigne` en une consigne VÉRIFIÉE contre les listes
// réelles (ressources, chantiers, lots, tâches, interventions du planning),
// puis en une fiche lisible et en LA ligne exacte à enregistrer.
//
// Le même module sert deux fois :
//   - côté serveur (api/_ia/taches/renovation_planning_consigne.js) pour
//     refuser un JSON qui cite un identifiant inexistant ou un type inconnu ;
//   - côté navigateur, juste avant l'écriture, avec en plus les avertissements
//     qui demandent le rythme de travail (jour à 0 h) et l'équipe du lot : ces
//     deux règles vivent dans src/rythmeSemaine.js et planningResourceModelV1.js,
//     elles sont INJECTÉES (capaciteBase, membresEquipeLot), jamais recopiées.
//
// Extension .mjs sans import de fichier .js : la fonction serveur (CommonJS)
// peut le charger par `await import()` sans dépendre de la détection de
// syntaxe de Node.

export const ASSISTANT_PLANNING_CONSIGNE_VERSION = 1;

export const NATURES_CONSIGNE = Object.freeze({
  ABSENCE: "absence",
  RESSOURCE_IMPOSEE: "ressource_imposee",
  DATE_IMPOSEE: "date_imposee",
  INTERVENTION_VERROUILLEE: "intervention_verrouillee",
});

export const TABLE_EVENEMENTS = "planning_resource_events";
export const TABLE_CONTRAINTES = "planning_constraints";
export const SOURCE_ASSISTANT = "assistant";
export const VIA_ASSISTANT = "assistant_planning";

const ETIQUETTES = {
  absence: "Absence",
  ressource_imposee: "Affectation imposée",
  date_imposee: "Date imposée",
  intervention_verrouillee: "Intervention figée",
};

const JOURS_LONGS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const JOURS_COURTS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const DUREE_MAX_JOURS = 92;

const str = v => String(v ?? "").trim();
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(str).filter(Boolean))];

// ── Dates (calendrier civil pur, sans fuseau) ────────────────────────────────

export function dateISOv1(v) {
  const s = str(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Refuse les dates « débordantes » (2026-02-31 → 03-03).
  return formaterISO(d) === s ? s : null;
}

function formaterISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ajouterJoursV1(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return formaterISO(d);
}

export function ecartJoursV1(a, b) {
  const da = new Date(`${a}T12:00:00`);
  const db = new Date(`${b}T12:00:00`);
  return Math.round((da - db) / 86400000);
}

export function jourSemaineV1(iso) {
  return new Date(`${iso}T12:00:00`).getDay();
}

export function libelleDateV1(iso, { court = false } = {}) {
  const d = dateISOv1(iso);
  if (!d) return "—";
  const [y, m, j] = d.split("-");
  const jour = (court ? JOURS_COURTS : JOURS_LONGS)[jourSemaineV1(d)];
  return court ? `${jour} ${j}/${m}` : `${jour.charAt(0).toUpperCase()}${jour.slice(1)} ${j}/${m}/${y}`;
}

export function lundiDeLaSemaineV1(iso) {
  const d = dateISOv1(iso);
  if (!d) return null;
  const js = jourSemaineV1(d);
  return ajouterJoursV1(d, js === 0 ? -6 : 1 - js);
}

// Semaine ISO-8601 (le jeudi fixe l'année). Même règle que getISOWeek de
// src/rythmeSemaine.js ; l'égalité est vérifiée jour par jour par
// scripts/verif-assistant-planning-etape-2.mjs.
export function semaineISOv1(iso) {
  const d = dateISOv1(iso);
  if (!d) return null;
  const jeudi = ajouterJoursV1(d, 4 - (jourSemaineV1(d) || 7));
  const annee = Number(jeudi.slice(0, 4));
  const semaine = Math.floor(ecartJoursV1(jeudi, `${annee}-01-01`) / 7) + 1;
  return { annee, semaine, week_id: `${annee}-W${String(semaine).padStart(2, "0")}` };
}

const NOMS_JOURS_PLANNING = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

/** Semaine + jour d'une cellule du planning (planning_cells.week_id / jour). */
export function celluleDuJourV1(iso) {
  const s = semaineISOv1(iso);
  return s ? { week_id: s.week_id, jour: NOMS_JOURS_PLANNING[jourSemaineV1(iso)] } : null;
}

/**
 * Calendrier donné au modèle pour qu'il n'ait AUCUN calcul de date à faire :
 * il lit « lundi prochain » dans une table. `aujourdhui` est fourni par
 * l'appelant (pas d'horloge ici).
 */
export function calendrierConsignesV1(aujourdhui, nbJours = 42) {
  const debut = dateISOv1(aujourdhui);
  if (!debut) return [];
  const lundiCourant = lundiDeLaSemaineV1(debut);
  return Array.from({ length: nbJours }, (_, i) => {
    const date = ajouterJoursV1(debut, i);
    const decalageSemaines = Math.floor(ecartJoursV1(lundiDeLaSemaineV1(date), lundiCourant) / 7);
    return {
      date,
      jour: JOURS_LONGS[jourSemaineV1(date)],
      libelle: libelleDateV1(date),
      semaine: decalageSemaines === 0 ? "cette semaine" : decalageSemaines === 1 ? "semaine prochaine" : `dans ${decalageSemaines} semaines`,
      aujourdhui: i === 0,
    };
  });
}

// ── Recherche texte ──────────────────────────────────────────────────────────

export function cleTexteV1(v) {
  return str(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr-FR").replace(/\s+/g, " ");
}

function correspond(texte, ...champs) {
  const cle = cleTexteV1(texte);
  if (!cle) return true;
  const mots = cle.split(" ").filter(Boolean);
  const cible = champs.map(cleTexteV1).join(" ");
  return mots.every(m => cible.includes(m));
}

// ── Référentiel ──────────────────────────────────────────────────────────────

export function personnesActivesV1(ressources = []) {
  return (Array.isArray(ressources) ? ressources : [])
    .filter(r => str(r?.id) && r.actif !== false && (r.kind || "personne") === "personne")
    .map(r => ({ id: str(r.id), nom: str(r.nom_planning || r.nom) || str(r.id) }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

export function chercherRessourcesV1(ressources, texte) {
  const personnes = personnesActivesV1(ressources);
  const cle = cleTexteV1(texte);
  const trouvees = cle
    ? personnes.filter(p => cleTexteV1(p.nom) === cle || cleTexteV1(p.nom).includes(cle) || (cle.length >= 3 && cle.includes(cleTexteV1(p.nom))))
    : [];
  const exactes = trouvees.filter(p => cleTexteV1(p.nom) === cle);
  const resultat = exactes.length === 1 ? exactes : trouvees;
  return { texte: str(texte), trouvees: resultat, ambigu: resultat.length > 1, inconnu: resultat.length === 0, toutes: personnes.map(p => p.nom) };
}

function nomLot(gt) {
  return str(gt?.nom || gt?.label || gt?.libelle) || str(gt?.id);
}

function tachesDuPhasage(phasage) {
  const groupes = Array.isArray(phasage?.plan_travaux?.meta?.chrono_groupes) ? phasage.plan_travaux.meta.chrono_groupes : [];
  const gtParChrono = new Map(groupes.filter(g => str(g?.id)).map(g => [str(g.id), str(g.groupe_type_id) || null]));
  const out = [];
  for (const o of Array.isArray(phasage?.ouvrages) ? phasage.ouvrages : []) {
    for (const t of Array.isArray(o?.taches) ? o.taches : []) {
      if (!str(t?.id)) continue;
      const av = Number(t.avancement);
      out.push({
        tache_id: str(t.id),
        nom: str(t.nom) || "Tâche sans libellé",
        groupe_type_id: str(t.groupe_type_id) || gtParChrono.get(str(t.chrono_groupe_id)) || null,
        avancement: Number.isFinite(av) ? av : 0,
        ouverte: !(Number.isFinite(av) && av >= 100),
        nb_ouvriers: uniq(t.ouvriers).length,
      });
    }
  }
  return out;
}

/**
 * Lots et tâches d'un chantier, filtrés par un texte (« ossature placo »).
 * Seules les tâches encore ouvertes sont proposées : une consigne sur une
 * tâche terminée n'aurait aucun effet.
 */
export function travauxDuChantierV1({ phasage, groupesTypes = [], texte = "" } = {}) {
  const gtParId = new Map((Array.isArray(groupesTypes) ? groupesTypes : []).filter(g => str(g?.id)).map(g => [str(g.id), g]));
  const taches = tachesDuPhasage(phasage).filter(t => t.ouverte);
  const lotsMap = new Map();
  for (const t of taches) {
    if (!t.groupe_type_id) continue;
    const e = lotsMap.get(t.groupe_type_id) || { groupe_type_id: t.groupe_type_id, nom: nomLot(gtParId.get(t.groupe_type_id)) || t.groupe_type_id, taches_ouvertes: 0 };
    e.taches_ouvertes++;
    lotsMap.set(t.groupe_type_id, e);
  }
  const lots = [...lotsMap.values()].filter(l => correspond(texte, l.nom)).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const tachesTrouvees = taches
    .filter(t => correspond(texte, t.nom, t.groupe_type_id ? nomLot(gtParId.get(t.groupe_type_id)) : ""))
    .map(t => ({ ...t, lot: t.groupe_type_id ? (nomLot(gtParId.get(t.groupe_type_id)) || t.groupe_type_id) : null }));
  return { chantier_id: str(phasage?.chantier_id) || null, lots, travaux: tachesTrouvees };
}

/** Lignes du planning (planning_cells) posées un jour donné. */
export function interventionsDuJourV1({ cellules = [], date, chantierId = null, verrous = [] } = {}) {
  const cible = celluleDuJourV1(date);
  if (!cible) return [];
  const verrouilles = new Set((Array.isArray(verrous) ? verrous : []).map(v => str(v?.allocation_id)).filter(Boolean));
  const out = [];
  for (const c of Array.isArray(cellules) ? cellules : []) {
    if (str(c?.week_id) !== cible.week_id || str(c?.jour) !== cible.jour) continue;
    if (chantierId && str(c?.chantier_id) !== str(chantierId)) continue;
    for (const l of Array.isArray(c?.taches) ? c.taches : []) {
      const uid = str(l?.allocation_uid);
      if (!uid) continue;
      const ouvriers = uniq(Array.isArray(l.ouvriers) && l.ouvriers.length ? l.ouvriers : c.ouvriers);
      const duree = Number(l.duree);
      out.push({
        allocation_uid: uid,
        chantier_id: str(c.chantier_id),
        date,
        tache_id: str(l.tache_id) || null,
        texte: str(l.text) || null,
        duree: Number.isFinite(duree) ? duree : 0,
        ouvriers,
        verrouillee: verrouilles.has(uid),
      });
    }
  }
  return out;
}

// ── Validation ───────────────────────────────────────────────────────────────

function erreur(code, message) { return { code, message }; }
function avert(code, message, niveau = "attention") { return { code, message, niveau }; }

function verifierPeriode(c, aujourdhui, erreurs, { obligatoire = true } = {}) {
  const debut = c.date_debut == null || c.date_debut === "" ? null : dateISOv1(c.date_debut);
  const finBrute = c.date_fin == null || c.date_fin === "" ? null : dateISOv1(c.date_fin);
  if (c.date_debut && !debut) erreurs.push(erreur("date_invalide", `Date de début illisible : « ${str(c.date_debut)} ».`));
  if (c.date_fin && !finBrute) erreurs.push(erreur("date_invalide", `Date de fin illisible : « ${str(c.date_fin)} ».`));
  if (obligatoire && !debut && !c.date_debut) erreurs.push(erreur("date_manquante", "La date manque."));
  const fin = finBrute || debut;
  if (debut && fin && fin < debut) erreurs.push(erreur("periode_inversee", "La date de fin est avant la date de début."));
  if (debut && fin && ecartJoursV1(fin, debut) > DUREE_MAX_JOURS) {
    erreurs.push(erreur("periode_trop_longue", `Période de plus de ${DUREE_MAX_JOURS} jours : à saisir dans Réglages → Ressources si c'est voulu.`));
  }
  const auj = dateISOv1(aujourdhui);
  if (auj && fin && fin < auj) erreurs.push(erreur("date_passee", `La période se termine le ${libelleDateV1(fin)}, avant aujourd'hui : elle ne changerait rien au recalcul.`));
  return { debut, fin };
}

function joursDe(debut, fin) {
  if (!debut) return [];
  const out = [];
  for (let d = debut; d <= (fin || debut) && out.length <= DUREE_MAX_JOURS; d = ajouterJoursV1(d, 1)) out.push(d);
  return out;
}

function joursSansCapacite(debut, fin, capaciteBase) {
  if (typeof capaciteBase !== "function") return null;
  return joursDe(debut, fin).filter(d => !(Number(capaciteBase(d)) > 0));
}

function libelleJoursZero(jours) {
  return jours.map(d => `${libelleDateV1(d, { court: true })} 0 h`).join(", ");
}

function periodeTexte(debut, fin) {
  if (!debut) return "Toute la durée";
  if (!fin || fin === debut) return libelleDateV1(debut);
  return `Du ${libelleDateV1(debut)} au ${libelleDateV1(fin)}`;
}

/**
 * Vérifie une consigne proposée et construit la fiche + la ligne à écrire.
 *
 * @param consigne     objet `consigne` rendu par la tâche IA
 * @param referentiel  { ressources, chantiers, groupesTypes, phasages,
 *                       interventions, evenements, contraintes }
 * @param options      { aujourdhui (obligatoire), capaciteBase?(iso)→h,
 *                       membresEquipeLot?(groupe_type_id)→[resource_id]|null }
 * @returns {{ ok, erreurs, fiche, table, ligne }}
 */
export function validerConsigneV1(consigne, referentiel = {}, options = {}) {
  const erreurs = [];
  const avertissements = [];
  const c = consigne && typeof consigne === "object" ? consigne : {};
  const nature = str(c.nature);
  const aujourdhui = dateISOv1(options.aujourdhui);
  if (!aujourdhui) return { ok: false, erreurs: [erreur("aujourdhui_manquant", "Date du jour absente : validation impossible.")], fiche: null, table: null, ligne: null };
  if (!Object.values(NATURES_CONSIGNE).includes(nature)) {
    return { ok: false, erreurs: [erreur("nature_inconnue", `Type de consigne inconnu : « ${nature || "vide"} ».`)], fiche: null, table: null, ligne: null };
  }

  const personnes = new Map(personnesActivesV1(referentiel.ressources).map(p => [p.id, p]));
  const toutesRessources = new Map((referentiel.ressources || []).filter(r => str(r?.id)).map(r => [str(r.id), r]));
  const chantiers = new Map((referentiel.chantiers || []).filter(x => str(x?.id)).map(x => [str(x.id), x]));
  const gtParId = new Map((referentiel.groupesTypes || []).filter(g => str(g?.id)).map(g => [str(g.id), g]));
  const nomPersonne = id => personnes.get(id)?.nom || str(toutesRessources.get(id)?.nom_planning || toutesRessources.get(id)?.nom) || id;

  const verifierPersonne = id => {
    if (!id) { erreurs.push(erreur("personne_manquante", "La personne concernée manque.")); return false; }
    if (personnes.has(id)) return true;
    const r = toutesRessources.get(id);
    if (!r) erreurs.push(erreur("personne_inconnue", `Aucune ressource ne porte l'identifiant « ${id} ».`));
    else if (r.actif === false) erreurs.push(erreur("personne_inactive", `${nomPersonne(id)} est inactif(ve) dans Réglages → Ressources.`));
    else erreurs.push(erreur("personne_non_salariee", `${nomPersonne(id)} n'est pas une personne planifiable (prestataire).`));
    return false;
  };
  const verifierChantier = id => {
    if (!id) { erreurs.push(erreur("chantier_manquant", "Le chantier manque.")); return null; }
    const ch = chantiers.get(id);
    if (!ch) { erreurs.push(erreur("chantier_inconnu", `Aucun chantier ne porte l'identifiant « ${id} ».`)); return null; }
    if (str(ch.statut) === "termine") { erreurs.push(erreur("chantier_termine", `${str(ch.nom) || id} est terminé : le moteur ne le planifie plus.`)); return null; }
    return ch;
  };
  const phasageDe = id => (referentiel.phasages || []).find(p => str(p?.chantier_id) === id) || null;

  const lignesFiche = [];
  let table = null;
  let ligne = null;
  let periode = { debut: null, fin: null };
  let effet = "";
  let visibilite = "";
  const capaciteBase = options.capaciteBase;

  if (nature === NATURES_CONSIGNE.ABSENCE) {
    const rid = str(c.resource_id || (Array.isArray(c.resource_ids) ? c.resource_ids[0] : ""));
    const okP = verifierPersonne(rid);
    periode = verifierPeriode(c, aujourdhui, erreurs);
    const touteJournee = c.toute_journee !== false;
    const heures = touteJournee ? null : Number(c.heures);
    if (!touteJournee && !(heures > 0 && heures <= 12)) erreurs.push(erreur("heures_invalides", "Une absence partielle doit indiquer un nombre d'heures entre 0 et 12."));
    if (okP && periode.debut) {
      const zero = joursSansCapacite(periode.debut, periode.fin, capaciteBase);
      if (zero && zero.length) avertissements.push(avert("jour_zero_heure", `${libelleJoursZero(zero)} : jour non travaillé, l'absence n'y retire rien.`, "info"));
      const chevauche = (referentiel.evenements || []).filter(e => str(e?.resource_id) === rid && e.actif !== false
        && str(e.date_debut) <= (periode.fin || periode.debut) && str(e.date_fin || e.date_debut) >= periode.debut);
      if (chevauche.length) avertissements.push(avert("absence_existante", `Une absence ou indisponibilité de ${nomPersonne(rid)} est déjà enregistrée sur cette période (${chevauche.map(e => periodeTexte(str(e.date_debut), str(e.date_fin))).join(" ; ")}).`));
    }
    lignesFiche.push({ libelle: "Qui", valeur: okP ? nomPersonne(rid) : (rid || "—") });
    lignesFiche.push({ libelle: "Quand", valeur: periodeTexte(periode.debut, periode.fin) });
    lignesFiche.push({ libelle: "Durée", valeur: touteJournee ? "Journée entière" : `${heures} h indisponibles par jour` });
    effet = `Ses tâches de ${periode.fin && periode.fin !== periode.debut ? "cette période" : "ce jour-là"} seront replacées par le moteur.`;
    visibilite = "Visible et annulable dans l'assistant et dans Réglages → Ressources.";
    table = TABLE_EVENEMENTS;
    ligne = {
      resource_id: rid,
      type: "absence",
      date_debut: periode.debut,
      date_fin: periode.fin || periode.debut,
      toute_journee: touteJournee,
      heures_indisponibles: touteJournee ? null : heures,
      capacite_heures: null,
      motif: str(c.motif) || "Absence déclarée via l'assistant",
      motif_code: null,
      source: SOURCE_ASSISTANT,
      details: { via: VIA_ASSISTANT },
      actif: true,
    };
  }

  if (nature === NATURES_CONSIGNE.RESSOURCE_IMPOSEE) {
    const rids = uniq(c.resource_ids || (c.resource_id ? [c.resource_id] : []));
    if (!rids.length) erreurs.push(erreur("personne_manquante", "La personne à imposer manque."));
    const okP = rids.every(verifierPersonne);
    const ch = verifierChantier(str(c.chantier_id));
    const gtId = str(c.groupe_type_id) || null;
    const tacheId = str(c.tache_id) || null;
    if (!!gtId === !!tacheId) erreurs.push(erreur("portee_ambigue", "Préciser soit le lot (travaux), soit une tâche — un seul des deux."));
    periode = verifierPeriode(c, aujourdhui, erreurs, { obligatoire: false });
    let travauxNom = null;
    if (ch) {
      const travaux = travauxDuChantierV1({ phasage: phasageDe(str(ch.id)), groupesTypes: referentiel.groupesTypes });
      if (gtId) {
        const lot = travaux.lots.find(l => l.groupe_type_id === gtId);
        if (!gtParId.has(gtId)) erreurs.push(erreur("lot_inconnu", `Aucun lot ne porte l'identifiant « ${gtId} ».`));
        else if (!lot) erreurs.push(erreur("lot_absent_du_chantier", `Le lot « ${nomLot(gtParId.get(gtId))} » n'a aucune tâche ouverte sur ${str(ch.nom) || ch.id}.`));
        else travauxNom = lot.nom;
      }
      if (tacheId) {
        const t = tachesDuPhasage(phasageDe(str(ch.id))).find(x => x.tache_id === tacheId);
        if (!t) erreurs.push(erreur("tache_inconnue", `Aucune tâche « ${tacheId} » sur ${str(ch.nom) || ch.id}.`));
        else if (!t.ouverte) erreurs.push(erreur("tache_terminee", `La tâche « ${t.nom} » est terminée : la consigne n'aurait aucun effet.`));
        else {
          travauxNom = t.nom;
          if (t.nb_ouvriers > rids.length) avertissements.push(avert("equipe_incomplete", `Cette tâche demande ${t.nb_ouvriers} personnes : avec ${rids.length} personne(s) imposée(s), le moteur ne pourra pas la placer.`));
        }
      }
    }
    const lotPourEquipe = gtId || (tacheId && ch ? tachesDuPhasage(phasageDe(str(ch.id))).find(x => x.tache_id === tacheId)?.groupe_type_id : null);
    let horsEquipe = null;
    if (okP && lotPourEquipe && typeof options.membresEquipeLot === "function") {
      const membres = options.membresEquipeLot(lotPourEquipe);
      if (Array.isArray(membres)) {
        horsEquipe = rids.filter(id => !membres.includes(id));
        const gt = gtParId.get(lotPourEquipe);
        if (horsEquipe.length) {
          avertissements.push(avert("hors_equipe", `${horsEquipe.map(nomPersonne).join(", ")} ne fait pas partie de l'équipe habituelle du lot « ${nomLot(gt)} ». C'est une exception à la règle habituelle : chaque proposition du moteur qui l'utilise la portera comme telle.`));
        }
      }
    }
    if (okP && ch && travauxNom) {
      avertissements.push(avert("equipe_restreinte", `Sur ${str(ch.nom) || ch.id}, ces travaux ne seront proposés qu'à ${rids.map(nomPersonne).join(", ")} tant que la consigne est active.`, "info"));
    }
    const doublon = (referentiel.contraintes || []).find(k => k?.actif !== false && k.type === "resource_required"
      && str(k.chantier_id) === str(c.chantier_id) && str(k.groupe_type_id) === str(gtId) && str(k.tache_id) === str(tacheId));
    if (doublon) avertissements.push(avert("consigne_existante", "Une consigne de ressource imposée existe déjà sur ces travaux : les deux s'appliqueront ensemble."));
    lignesFiche.push({ libelle: "Qui", valeur: rids.map(nomPersonne).join(", ") || "—" });
    lignesFiche.push({ libelle: "Travaux", valeur: travauxNom || gtId || tacheId || "—" });
    lignesFiche.push({ libelle: "Chantier", valeur: str(ch?.nom) || str(c.chantier_id) || "—" });
    lignesFiche.push({ libelle: "Portée", valeur: "Ce chantier et ces travaux uniquement" });
    const finImposee = dateISOv1(c.date_fin) || null;
    lignesFiche.push({
      libelle: "Quand",
      valeur: !periode.debut && !finImposee ? "Tant que la consigne est active"
        : periode.debut && !finImposee ? `À partir du ${libelleDateV1(periode.debut)}`
          : !periode.debut ? `Jusqu'au ${libelleDateV1(finImposee)}`
            : periodeTexte(periode.debut, finImposee),
    });
    effet = "Le moteur place la personne imposée sur ces travaux, même hors de l'équipe du lot.";
    visibilite = "Visible et annulable dans l'assistant. Marquée « exception » dans les propositions du moteur.";
    table = TABLE_CONTRAINTES;
    ligne = {
      type: "resource_required",
      scope: tacheId ? "tache" : "groupe",
      chantier_id: str(c.chantier_id) || null,
      groupe_type_id: tacheId ? null : gtId,
      tache_id: tacheId,
      allocation_id: null,
      hard: true,
      priority: 0,
      date_debut: periode.debut,
      date_fin: finImposee,
      config: { resource_ids: rids, via: VIA_ASSISTANT, exception_hors_equipe: horsEquipe ? horsEquipe.length > 0 : null },
      label: `${rids.map(nomPersonne).join(", ")} imposé(e)(s) — ${travauxNom || "travaux"} (${str(ch?.nom) || str(c.chantier_id)})`,
      source: SOURCE_ASSISTANT,
      actif: true,
    };
  }

  if (nature === NATURES_CONSIGNE.DATE_IMPOSEE) {
    const ch = verifierChantier(str(c.chantier_id));
    const tacheId = str(c.tache_id);
    periode = verifierPeriode(c, aujourdhui, erreurs);
    let t = null;
    if (!tacheId) erreurs.push(erreur("tache_manquante", "La tâche concernée manque."));
    else if (ch) {
      t = tachesDuPhasage(phasageDe(str(ch.id))).find(x => x.tache_id === tacheId) || null;
      if (!t) erreurs.push(erreur("tache_inconnue", `Aucune tâche « ${tacheId} » sur ${str(ch.nom) || ch.id}.`));
      else if (!t.ouverte) erreurs.push(erreur("tache_terminee", `La tâche « ${t.nom} » est terminée : la consigne n'aurait aucun effet.`));
    }
    if (periode.debut) {
      const jours = joursDe(periode.debut, periode.fin);
      const zero = joursSansCapacite(periode.debut, periode.fin, capaciteBase);
      if (zero && zero.length === jours.length) {
        erreurs.push(erreur("date_zero_heure", `${libelleJoursZero(zero)} : le moteur ne peut rien placer un jour non travaillé. Placez l'intervention dans le planning, puis demandez-moi de la verrouiller.`));
      } else if (zero && zero.length) {
        avertissements.push(avert("jour_zero_heure", `${libelleJoursZero(zero)} : jour non travaillé, le moteur n'y placera rien.`, "info"));
      }
    }
    lignesFiche.push({ libelle: "Tâche", valeur: t?.nom || tacheId || "—" });
    lignesFiche.push({ libelle: "Chantier", valeur: str(ch?.nom) || str(c.chantier_id) || "—" });
    lignesFiche.push({ libelle: "Quand", valeur: periodeTexte(periode.debut, periode.fin) });
    effet = "Le moteur ne place cette tâche que dans cette fenêtre ; ailleurs, elle attend.";
    visibilite = "Visible et annulable dans l'assistant.";
    table = TABLE_CONTRAINTES;
    ligne = {
      type: "fixed_date",
      scope: "tache",
      chantier_id: str(c.chantier_id) || null,
      groupe_type_id: null,
      tache_id: tacheId || null,
      allocation_id: null,
      hard: true,
      priority: 0,
      date_debut: periode.debut,
      date_fin: periode.fin || periode.debut,
      config: { resource_ids: [], via: VIA_ASSISTANT },
      label: `Date imposée — ${t?.nom || tacheId} (${str(ch?.nom) || str(c.chantier_id)})`,
      source: SOURCE_ASSISTANT,
      actif: true,
    };
  }

  if (nature === NATURES_CONSIGNE.INTERVENTION_VERROUILLEE) {
    const uid = str(c.allocation_uid);
    const inter = (referentiel.interventions || []).find(i => str(i?.allocation_uid) === uid) || null;
    if (!uid) erreurs.push(erreur("intervention_manquante", "L'intervention du planning à verrouiller manque. Placez-la d'abord dans le planning."));
    else if (!inter) erreurs.push(erreur("intervention_inconnue", "Cette intervention n'existe pas dans le planning à la date indiquée. Placez-la d'abord dans le planning, puis redemandez."));
    else if (inter.verrouillee) erreurs.push(erreur("deja_verrouillee", "Cette intervention est déjà verrouillée."));
    const ch = inter ? chantiers.get(inter.chantier_id) : null;
    if (inter) {
      periode = verifierPeriode({ date_debut: inter.date }, aujourdhui, erreurs);
      if (c.date && dateISOv1(c.date) && dateISOv1(c.date) !== inter.date) {
        erreurs.push(erreur("date_incoherente", `Cette intervention est posée le ${libelleDateV1(inter.date)}, pas le ${libelleDateV1(c.date)}.`));
      }
      const zero = joursSansCapacite(inter.date, inter.date, capaciteBase);
      if (zero && zero.length) {
        avertissements.push(avert("jour_zero_heure", `Le ${JOURS_LONGS[jourSemaineV1(inter.date)]} ${libelleDateV1(inter.date, { court: true }).split(" ")[1]} est normalement non travaillé (0 h). Je la garde comme exception : le moteur ne la déplacera pas, et n'ajoutera rien d'autre ce jour-là.`));
      }
      if (!inter.tache_id) avertissements.push(avert("sans_tache", "Intervention sans tâche liée : le moteur la garde déjà telle quelle ; le verrou la protège aussi des déplacements dans le planning.", "info"));
      else avertissements.push(avert("heures_deduites", "Ses heures sont déduites du reste à faire de la tâche ; le moteur ne replace que le reste.", "info"));
    }
    lignesFiche.push({ libelle: "Quand", valeur: inter ? libelleDateV1(inter.date) : "—" });
    lignesFiche.push({ libelle: "Chantier", valeur: str(ch?.nom) || str(inter?.chantier_id) || "—" });
    lignesFiche.push({ libelle: "Qui", valeur: inter?.ouvriers?.length ? inter.ouvriers.join(", ") : "—" });
    lignesFiche.push({ libelle: "Durée", valeur: inter ? `${inter.duree} h${inter.texte ? ` · ${inter.texte}` : ""}` : "—" });
    effet = "Le moteur ne déplace pas cette intervention et en tient compte dans la charge de chacun.";
    visibilite = "Visible et annulable dans l'assistant ; le cadenas apparaît dans la cellule du planning, qui ne peut plus être déplacée par glisser.";
    table = TABLE_CONTRAINTES;
    ligne = {
      type: "allocation_lock",
      scope: "allocation",
      chantier_id: inter?.chantier_id || null,
      groupe_type_id: null,
      tache_id: null,
      allocation_id: uid || null,
      hard: true,
      priority: 0,
      date_debut: null,
      date_fin: null,
      config: { locked_by_user: true, via: VIA_ASSISTANT },
      label: "Intervention verrouillée via l'assistant",
      source: SOURCE_ASSISTANT,
      actif: true,
    };
  }

  const ok = erreurs.length === 0;
  return {
    ok,
    erreurs,
    table: ok ? table : null,
    ligne: ok ? ligne : null,
    fiche: {
      nature,
      etiquette: ETIQUETTES[nature],
      lignes: lignesFiche,
      effet,
      visibilite,
      avertissements,
      periode: { debut: periode.debut, fin: periode.fin || periode.debut },
    },
  };
}

// ── Consignes déjà créées par l'assistant (liste du panneau) ────────────────

export function consignesAssistantV1({ contraintes = [], evenements = [], ressources = [], chantiers = [] } = {}) {
  const noms = new Map(personnesActivesV1(ressources).map(p => [p.id, p.nom]));
  (ressources || []).forEach(r => { if (str(r?.id) && !noms.has(str(r.id))) noms.set(str(r.id), str(r.nom_planning || r.nom) || str(r.id)); });
  const nomsCh = new Map((chantiers || []).filter(x => str(x?.id)).map(x => [str(x.id), str(x.nom) || str(x.id)]));
  const out = [];
  for (const e of Array.isArray(evenements) ? evenements : []) {
    if (e?.source !== SOURCE_ASSISTANT || e.actif === false) continue;
    out.push({
      table: TABLE_EVENEMENTS,
      id: str(e.id),
      nature: NATURES_CONSIGNE.ABSENCE,
      etiquette: ETIQUETTES.absence,
      texte: `${noms.get(str(e.resource_id)) || e.resource_id} — ${periodeTexte(str(e.date_debut), str(e.date_fin))}`,
      cree_le: str(e.created_at) || null,
    });
  }
  const NATURE_PAR_TYPE = { resource_required: "ressource_imposee", fixed_date: "date_imposee", allocation_lock: "intervention_verrouillee" };
  for (const k of Array.isArray(contraintes) ? contraintes : []) {
    if (k?.source !== SOURCE_ASSISTANT || k.actif === false) continue;
    const nature = NATURE_PAR_TYPE[k.type] || null;
    out.push({
      table: TABLE_CONTRAINTES,
      id: str(k.id),
      nature,
      etiquette: ETIQUETTES[nature] || k.type,
      texte: str(k.label) || `${k.type} — ${nomsCh.get(str(k.chantier_id)) || k.chantier_id || ""}`,
      cree_le: str(k.created_at) || null,
    });
  }
  return out.sort((a, b) => str(b.cree_le).localeCompare(str(a.cree_le)));
}

// ── Fenêtre de simulation adaptée à la consigne ──────────────────────────────

/**
 * startDate = le plus tôt entre le prochain jour planifiable et le début de la
 * consigne (sans remonter avant demain : le moteur ignore le passé) ; horizon
 * assez long pour couvrir la consigne + deux semaines, entre 42 et 84 jours.
 */
export function fenetreSimulationConsigneV1({ periode = {}, prochainJourPlanifiable, demain } = {}) {
  const base = dateISOv1(prochainJourPlanifiable);
  const min = dateISOv1(demain) || base;
  let debut = base;
  const pDebut = dateISOv1(periode.debut);
  if (pDebut && base && pDebut < base) debut = pDebut < min ? min : pDebut;
  const fin = dateISOv1(periode.fin) || pDebut;
  let horizon = 42;
  if (debut && fin) horizon = Math.max(42, Math.min(84, ecartJoursV1(fin, debut) + 15));
  return { startDate: debut, horizonDays: horizon };
}

// ── Aperçu sans consigne : « fais / montre le planning de … » ────────────────
// Demande la plus simple : voir ce que le moteur propose sur une période, pour
// un ou plusieurs chantiers. Rien n'est enregistré (ni consigne, ni planning).

export const JOURS_CALENDRIER = 42;   // calendrier donné au modèle
export const APERCU_JOURS_MAX = 42;   // période affichable : 6 semaines
export const MAX_CHOIX_QUESTION = 6;  // boutons d'une question, « Tous les … » compris

/**
 * Chantiers dont le nom contient tous les mots cherchés (« fourmond » → les
 * quatre FOURMOND). Un chantier terminé n'est jamais proposé : le moteur ne le
 * planifie plus.
 *   - aucun      → inconnu ;
 *   - un seul    → unique ;
 *   - plusieurs  → un choix par chantier + « Tous les <texte> », si le total
 *                  tient dans MAX_CHOIX_QUESTION ; sinon trop_nombreux et
 *                  AUCUN choix (on demande de préciser le nom).
 */
export function familleChantiersV1(chantiers, texte) {
  const cle = cleTexteV1(texte);
  const liste = (Array.isArray(chantiers) ? chantiers : [])
    .filter(c => str(c?.id) && str(c.statut) !== "termine")
    .map(c => ({ id: str(c.id), nom: str(c.nom) || str(c.id) }));
  const trouves = cle
    ? liste.filter(c => correspond(texte, c.nom, c.id)).sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
    : [];
  const nb = trouves.length;
  const tropNombreux = nb + 1 > MAX_CHOIX_QUESTION;
  const choix = nb > 1 && !tropNombreux
    ? [
      ...trouves.map(c => ({ libelle: c.nom, chantier_ids: [c.id] })),
      { libelle: `Tous les ${str(texte).toLocaleUpperCase("fr-FR")}`, chantier_ids: trouves.map(c => c.id) },
    ]
    : [];
  return {
    texte: str(texte),
    nb,
    chantiers: trouves,
    inconnu: nb === 0,
    unique: nb === 1,
    ambigu: nb > 1,
    trop_nombreux: nb > 1 && tropNombreux,
    choix,
  };
}

function periodeTexteApercu(debut, fin) {
  return debut === fin ? libelleDateV1(debut) : `du ${libelleDateV1(debut, { court: true })} au ${libelleDateV1(fin, { court: true })}`;
}

/**
 * Contrôle du périmètre d'un aperçu (serveur ET navigateur) : chantiers
 * existants et non terminés (liste vide = tous), dates lisibles, dans le
 * calendrier donné au modèle, non passées, période d'au plus 6 semaines.
 */
export function validerPerimetreApercuV1(perimetre, { chantiers = [], aujourdhui, joursCalendrier = JOURS_CALENDRIER } = {}) {
  const erreurs = [];
  const err = (code, message) => erreurs.push({ code, message });
  if (!perimetre || typeof perimetre !== "object" || Array.isArray(perimetre)) {
    err("perimetre_manquant", "Le périmètre de l'aperçu (chantiers et période) est manquant.");
    return { ok: false, erreurs, perimetre: null };
  }
  const connus = new Map((Array.isArray(chantiers) ? chantiers : []).filter(c => str(c?.id)).map(c => [str(c.id), c]));
  let ids = [];
  if (!Array.isArray(perimetre.chantier_ids)) err("chantiers_illisibles", "chantier_ids doit être une liste (vide = tous les chantiers).");
  else ids = uniq(perimetre.chantier_ids);
  const retenus = [];
  for (const id of ids) {
    const c = connus.get(id);
    if (!c) err("chantier_inconnu", `Aucun chantier ne porte l'identifiant ${id}.`);
    else if (str(c.statut) === "termine") err("chantier_termine", `Le chantier ${str(c.nom) || id} est terminé : il n'y a plus rien à planifier.`);
    else retenus.push({ id, nom: str(c.nom) || id });
  }

  const auj = dateISOv1(aujourdhui);
  const debut = dateISOv1(perimetre.date_debut);
  const fin = dateISOv1(perimetre.date_fin);
  if (!debut) err("date_illisible", `Date de début illisible : ${str(perimetre.date_debut) || "absente"}.`);
  if (!fin) err("date_illisible", `Date de fin illisible : ${str(perimetre.date_fin) || "absente"}.`);
  if (debut && fin && auj) {
    const derniere = ajouterJoursV1(auj, joursCalendrier - 1);
    if (debut < auj) err("date_passee", `La période commence le ${libelleDateV1(debut)}, avant aujourd'hui.`);
    if (debut > derniere || fin > derniere) err("hors_calendrier", `La période dépasse le calendrier fourni (jusqu'au ${libelleDateV1(derniere)}).`);
    if (fin < debut) err("fin_avant_debut", "La date de fin est avant la date de début.");
    else if (ecartJoursV1(fin, debut) + 1 > APERCU_JOURS_MAX) err("periode_trop_longue", "La période dépasse 6 semaines : demandez une période plus courte.");
  }
  const ok = erreurs.length === 0;
  return {
    ok,
    erreurs,
    perimetre: ok ? {
      chantier_ids: retenus.map(c => c.id),
      chantiers: retenus,
      tous: retenus.length === 0,
      date_debut: debut,
      date_fin: fin,
      libelle: `${retenus.length ? retenus.map(c => c.nom).join(", ") : "Tous les chantiers"} — ${periodeTexteApercu(debut, fin)}`,
    } : null,
  };
}
