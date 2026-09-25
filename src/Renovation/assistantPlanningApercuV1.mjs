// ─── ASSISTANT PLANNING — APERÇU AVANT / APRÈS V1 (chantier 10, étape 2) ────
// Module PUR : aucun accès Supabase, aucune horloge.
//
// Il compare DEUX résultats du moteur existant (simulerPlanningGlobalV1) :
// « avant » = calculé juste avant d'enregistrer la consigne, « après » =
// calculé juste après, en relisant la base. Rien n'est recalculé ici :
//   - ce qui a bougé vient du diff du chantier 05 (planningReplanningDiffV1.js),
//     appliqué entre les deux propositions ;
//   - les fins viennent de finPrevisionnelleParChantierV1 (même module que le
//     panneau Simulation) ;
//   - les raisons des tâches non planifiées sont celles du moteur, telles quelles.
// Ce module ne fait que ranger ces résultats dans une grille de semaine.
//
// Deux comparaisons :
//   - "consigne"        : proposition du moteur avant / après une consigne ;
//   - "planning_actuel" : planning actuel (planning_cells, tel qu'affiché
//     dans Planning semaine) / proposition du moteur, sans aucune consigne.
//     Le planning actuel est lu par l'adaptateur existant du planning de
//     référence v1 (allocationsDepuisCellules), que le moteur utilise déjà :
//     c'est le `forecast_courant` du résultat de simulerPlanningGlobalV1.

import { diffReplanningV1 } from "./planningReplanningDiffV1.js";
import { finPrevisionnelleParChantierV1, libelleFinPrevisionnelleV1 } from "./planningFinPrevisionnelleV1.mjs";
import { ajouterJoursV1, dateISOv1, ecartJoursV1, jourSemaineV1, libelleDateV1, lundiDeLaSemaineV1 } from "./assistantPlanningConsigneV1.mjs";

export const ASSISTANT_PLANNING_APERCU_VERSION = 1;

const str = v => String(v ?? "").trim();
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(str).filter(Boolean))];
const liste = xs => (Array.isArray(xs) ? xs : []);
const arrondi = n => Math.round((Number(n) || 0) * 100) / 100;
const heuresTxt = n => `${String(arrondi(n)).replace(".", ",")} h`;
const jjmm = iso => { const d = dateISOv1(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "—"; };
const court = iso => libelleDateV1(iso, { court: true });
const pluriel = (n, s, p = `${s}s`) => (n > 1 ? p : s);

// ─── Noms des tâches ────────────────────────────────────────────────────────
// Une tâche non planifiée n'a aucune affectation : son nom ne peut venir ni
// d'une case du planning ni de la proposition (le moteur ne renvoie que son
// identifiant). On le cherche dans les travaux reçus par le moteur, puis dans
// le phasage (`travaux_moteur`, `taches_phasage` du résultat de
// simulerPlanningGlobalV1). Un identifiant ne s'affiche jamais à la place d'un nom.

export const TACHE_SANS_NOM = "Tâche sans nom";
// Valeur posée par l'adaptateur du moteur quand le phasage n'a pas de nom.
const LIBELLE_MOTEUR_PAR_DEFAUT = "Tâche sans libellé";

export function creerNomTacheV1({ allocations = [], travaux = [], tachesPhasage = {} } = {}) {
  const propre = v => { const s = str(v); return s && s !== LIBELLE_MOTEUR_PAR_DEFAUT ? s : ""; };
  const noms = new Map();
  const noter = (id, nom) => {
    const k = str(id);
    const n = propre(nom);
    if (k && n && !noms.has(k)) noms.set(k, n);
  };
  liste(allocations).forEach(a => noter(a?.travail_id, a?.texte));
  liste(travaux).forEach(t => noter(t?.id, t?.texte));
  Object.entries(tachesPhasage || {}).forEach(([id, v]) => noter(id, v?.nom));
  return (travailId, texteDirect = "") => propre(texteDirect) || noms.get(str(travailId)) || TACHE_SANS_NOM;
}

function premierDe(resultats, cle) {
  for (const r of resultats) if (r && r[cle] != null) return r[cle];
  return null;
}

// ─── Non planifiées : trier avant d'alerter ─────────────────────────────────
// Deux familles, calculées sur la chaîne des prédécesseurs telle que le moteur
// l'a reçue :
//   - « après la période » : la tâche, ou la tâche qui la retient, ne peut
//     finir qu'après la fin de l'horizon (commencée mais pas finie, équipe du
//     lot prise sur tous les jours possibles, délai ou date après l'horizon) ;
//   - « bloquée » : une vraie impossibilité, qui ne se résout pas en attendant
//     (tâche exclue du calcul, équipe vide ou trop petite, équipe entière
//     exigée le même jour et jamais réunie, tâche non fractionnable plus
//     longue qu'une journée, prédécesseur introuvable, consigne impossible…).
//     Une seule racine bloquée suffit à bloquer.
// La raison et le code du moteur restent sur chaque tâche, inchangés ; la
// racine s'y ajoute.

export const CATEGORIES_NON_PLANIFIEE = Object.freeze({ APRES: "apres_periode", BLOQUEE: "bloquee" });
const { APRES, BLOQUEE } = CATEGORIES_NON_PLANIFIEE;
const CODES_APRES_PERIODE = new Set(["delai_technique_hors_horizon", "contrainte_date_hors_horizon"]);
const CODES_PREDECESSEUR_EXCLU = new Set(["predecesseur_exclu_regle_connue", "predecesseur_charge_reference_manquante"]);
export const CODE_CAPACITE = "capacite_ou_contraintes_horizon";
const EPS = 1e-6;

/**
 * @param nonPlanifies   non_planifies du moteur (TOUS les chantiers : la racine
 *                       peut être sur un autre chantier que la tâche retenue)
 * @param travaux        travaux reçus par le moteur (travaux_moteur)
 * @param travauxExclus  travaux exclus par l'adaptateur (travaux_exclus)
 * @param allocations    allocations proposées (toutes)
 * @param ressources     référentiel des ressources (id, nom_planning, kind)
 * @param horizon        { start_date, end_date }
 * @param capaciteBase   (iso) → heures planifiables du jour, injectée
 * @returns Map travail_id → { categorie, racine: { travail_id, … } }
 */
export function trierNonPlanifieesV1({
  nonPlanifies = [], travaux = [], travauxExclus = [], allocations = [], tachesPhasage = {},
  ressources = [], horizon = {}, capaciteBase = null, nomTache = null, nomChantier = null,
} = {}) {
  const debut = dateISOv1(horizon?.start_date);
  const fin = dateISOv1(horizon?.end_date);
  const np = new Map(liste(nonPlanifies).map(n => [str(n?.travail_id), n]));
  const tr = new Map(liste(travaux).map(t => [str(t?.id), t]));
  const exclus = new Map(liste(travauxExclus).filter(x => str(x?.travail_id)).map(x => [str(x.travail_id), x]));
  const personnes = new Map(liste(ressources).filter(r => str(r?.id) && (!r.kind || r.kind === "personne")).map(r => [str(r.id), str(r.nom_planning || r.nom) || null]));
  const datesPosees = new Map();
  liste(allocations).forEach(a => {
    const id = str(a?.travail_id);
    const d = dateISOv1(a?.date);
    if (!id || !d) return;
    if (!datesPosees.has(id)) datesPosees.set(id, []);
    datesPosees.get(id).push(d);
  });
  datesPosees.forEach(ds => ds.sort());
  const nomT = typeof nomTache === "function" ? nomTache : creerNomTacheV1({ allocations, travaux, tachesPhasage });
  const nomC = id => (typeof nomChantier === "function" && nomChantier(id)) || str(id);
  const nomsEquipe = ids => ids.map(id => personnes.get(id)).filter(Boolean).join(", ");
  const capacite = d => (typeof capaciteBase === "function" ? Number(capaciteBase(d)) || 0 : ([0, 6].includes(jourSemaineV1(d)) ? 0 : 1));
  const joursTravailles = (de, a) => {
    let n = 0;
    for (let d = de; d && a && d <= a; d = ajouterJoursV1(d, 1)) if (capacite(d) > EPS) n++;
    return n;
  };
  const capaciteMaxPeriode = () => {
    let m = 0;
    for (let d = debut; d && fin && d <= fin; d = ajouterJoursV1(d, 1)) m = Math.max(m, capacite(d));
    return m;
  };
  const chantierDe = id => str(tr.get(id)?.chantier_id || exclus.get(id)?.chantier_id || np.get(id)?.chantier_id) || (id.includes("::") ? id.split("::")[0] : "");

  const racine = (id, categorie, code, raison) => ({ categorie, racine_id: id, racine_code: code, racine_raison: raison });

  function capaciteDe(id, n, t) {
    const posees = datesPosees.get(id) || [];
    if (posees.length) {
      return racine(id, APRES, CODE_CAPACITE, `Commencée le ${jjmm(posees[0])} : ${heuresTxt(n.heures_mo_restantes)} restent à faire après le ${jjmm(fin)}.`);
    }
    if (!t) return racine(id, BLOQUEE, CODE_CAPACITE, str(n.raison));
    const pool = uniq(t.candidate_resource_ids).filter(rid => personnes.has(rid));
    const equipe = Math.max(1, Math.round(Number(t.crew_size) || 1));
    if (!pool.length) return racine(id, BLOQUEE, CODE_CAPACITE, "Aucune personne active dans l'équipe du lot.");
    if (equipe > pool.length) {
      return racine(id, BLOQUEE, CODE_CAPACITE, `Équipe de ${equipe} personnes demandée, ${pool.length} seulement dans l'équipe du lot (${nomsEquipe(pool)}).`);
    }
    const parPersonne = (Number(t.heures_mo_restantes) || 0) / equipe;
    const max = capaciteMaxPeriode();
    if (t.fractionnable === false && typeof capaciteBase === "function" && parPersonne > max + EPS) {
      return racine(id, BLOQUEE, CODE_CAPACITE, `Tâche non fractionnable de ${heuresTxt(parPersonne)} par personne : aucune journée de la période n'est aussi longue (${heuresTxt(max)} au plus).`);
    }
    // Possible dès le jour où son dernier prédécesseur posé se termine (le
    // moteur l'accepte le jour même), et jamais avant le début de la période.
    const finsPreds = uniq(t.predecesseur_ids).map(p => (datesPosees.get(p) || []).slice(-1)[0]).filter(Boolean).sort();
    const possibleDes = [debut, finsPreds.slice(-1)[0]].filter(Boolean).sort().slice(-1)[0] || debut;
    const jours = joursTravailles(possibleDes, fin);
    if (!jours) return racine(id, APRES, CODE_CAPACITE, `Possible seulement à partir du ${jjmm(possibleDes)}, après la fin de la période.`);
    const contrainte = Number(n?.tentatives?.dates_bloquees) > 0 ? " (ou empêchée par une contrainte de date)" : "";
    // Toute l'équipe du lot doit être réunie le même jour et ne l'est jamais :
    // attendre ne suffit pas, il faut revoir l'équipe demandée sur la tâche.
    if (equipe >= 2 && equipe === pool.length) {
      return racine(id, BLOQUEE, CODE_CAPACITE,
        `${equipe} personnes demandées ensemble sur la tâche (${nomsEquipe(pool)}) : elles ne sont jamais réunies le même jour sur ${jours === 1 ? "le seul jour possible" : `les ${jours} jours possibles`}, du ${jjmm(possibleDes)} au ${jjmm(fin)}.`);
    }
    return racine(id, APRES, CODE_CAPACITE,
      `Équipe du lot (${nomsEquipe(pool)}) jamais disponible au complet sur ${jours === 1 ? "le seul jour possible" : `les ${jours} jours possibles`}, du ${jjmm(possibleDes)} au ${jjmm(fin)}${contrainte}.`);
  }

  const memo = new Map();
  function evaluer(idBrut, pile) {
    const id = str(idBrut);
    if (memo.has(id)) return memo.get(id);
    if (pile.has(id)) return racine(id, BLOQUEE, "dependances_en_boucle", "Les dépendances de cette tâche forment une boucle : aucune ne peut commencer.");
    const exclu = exclus.get(id);
    const n = np.get(id);
    let out = null;
    if (exclu) out = racine(id, BLOQUEE, str(exclu.type) || "exclue_du_calcul", str(exclu.explication) || "Exclue du calcul automatique.");
    else if (n) {
      pile.add(id);
      const code = str(n.raison_code);
      const t = tr.get(id);
      if (code === "predecesseur_non_termine") {
        const amont = uniq(t?.predecesseur_ids).map(p => evaluer(p, pile)).filter(Boolean);
        out = amont.find(r => r.categorie === BLOQUEE) || amont.find(r => r.categorie === APRES)
          || racine(id, APRES, code, str(n.raison));
      } else if (CODES_PREDECESSEUR_EXCLU.has(code)) {
        const b = liste(n.blocages_predecesseurs_connus).find(x => str(x?.travail_id));
        out = b
          ? evaluer(b.travail_id, pile) || racine(str(b.travail_id), BLOQUEE, str(b.type) || code, str(b.explication) || str(n.raison))
          : racine(id, BLOQUEE, code, str(n.raison));
      } else if (CODES_APRES_PERIODE.has(code)) out = racine(id, APRES, code, str(n.raison));
      else if (code === CODE_CAPACITE) out = capaciteDe(id, n, t);
      else out = racine(id, BLOQUEE, code || "raison_inconnue", str(n.raison) || "Raison non fournie par le moteur");
      pile.delete(id);
    }
    memo.set(id, out);
    return out;
  }

  const out = new Map();
  for (const n of liste(nonPlanifies)) {
    const id = str(n?.travail_id);
    if (!id) continue;
    const r = evaluer(id, new Set()) || racine(id, BLOQUEE, str(n.raison_code) || "raison_inconnue", str(n.raison) || "Raison non fournie par le moteur");
    const datePrevue = dateISOv1(tachesPhasage?.[id]?.date_prevue);
    const cid = chantierDe(r.racine_id);
    out.set(id, {
      categorie: r.categorie,
      date_prevue: datePrevue,
      date_prevue_apres_periode: !!(datePrevue && fin && datePrevue > fin),
      racine: {
        travail_id: r.racine_id,
        elle_meme: r.racine_id === id,
        chantier_id: cid || null,
        chantier: nomC(cid),
        texte: nomT(r.racine_id),
        raison_code: r.racine_code,
        raison: r.racine_raison || "Raison non fournie par le moteur",
      },
    });
  }
  return out;
}

/** Regroupe les non planifiées par famille puis par chantier, avec les heures. */
export function regrouperNonPlanifieesV1(items = [], { finPeriode = null } = {}) {
  const parFamille = famille => {
    const groupes = new Map();
    liste(items).filter(i => i.categorie === famille).forEach(i => {
      const k = str(i.chantier_id) || str(i.chantier);
      if (!groupes.has(k)) groupes.set(k, { chantier_id: str(i.chantier_id) || null, chantier: i.chantier, heures: 0, taches: [] });
      const g = groupes.get(k);
      g.heures = arrondi(g.heures + (Number(i.heures_mo_restantes) || 0));
      g.taches.push(i);
    });
    return [...groupes.values()].sort((a, b) => str(a.chantier).localeCompare(str(b.chantier), "fr"));
  };
  const bloquees = parFamille(BLOQUEE);
  const apres = parFamille(APRES);
  const nb = gs => gs.reduce((s, g) => s + g.taches.length, 0);
  const nbB = nb(bloquees);
  const nbA = nb(apres);
  const fauteEquipe = apres.reduce((s, g) => s + g.taches.filter(t => t.racine?.raison_code === CODE_CAPACITE && /jamais disponible/.test(t.racine.raison)).length, 0);
  const partB = nbB ? `${nbB} ${pluriel(nbB, "tâche bloquée", "tâches bloquées")}` : "Aucune tâche bloquée";
  const partA = nbA ? `${nbA} ${pluriel(nbA, "prévue", "prévues")} après le ${jjmm(finPeriode)}` : "aucune après la période";
  return {
    bloquees,
    apres_periode: apres,
    synthese: {
      bloquees: nbB,
      apres_periode: nbA,
      apres_faute_equipe: fauteEquipe,
      fin_periode: dateISOv1(finPeriode),
      texte: `${partB}, ${partA}${fauteEquipe ? ` (dont ${fauteEquipe} faute d'équipe disponible)` : ""}.`,
    },
  };
}

function proposition(resultat) {
  if (!resultat || typeof resultat !== "object") return { allocations_proposees: [], non_planifies: [], warnings: [] };
  return resultat.proposition && typeof resultat.proposition === "object" ? resultat.proposition : resultat;
}

function cleAvertissement(w) {
  return [w?.type, w?.travail_id, w?.allocation_uid, w?.constraint_id, w?.chantier_id, w?.tache_id, w?.date, w?.explication].map(str).join("|");
}

function avertissementsDe(resultat) {
  return [
    ...(Array.isArray(resultat?.warnings_adaptateur) ? resultat.warnings_adaptateur : []),
    ...(Array.isArray(proposition(resultat).warnings) ? proposition(resultat).warnings : []),
  ];
}

function joursOuvresDeLaSemaine(lundi) {
  return [0, 1, 2, 3, 4].map(i => ajouterJoursV1(lundi, i));
}

/** Période couverte par les deux résultats (pour la navigation de semaine). */
export function semainesDisponiblesV1(apres) {
  const debut = dateISOv1(apres?.horizon?.start_date);
  const fin = dateISOv1(apres?.horizon?.end_date);
  if (!debut || !fin) return [];
  const out = [];
  for (let l = lundiDeLaSemaineV1(debut); l <= fin; l = ajouterJoursV1(l, 7)) out.push(l);
  return out;
}

const COMPARAISONS = new Set(["consigne", "planning_actuel"]);

function chantierDeAvertissement(w) {
  return str(w?.chantier_id) || (str(w?.travail_id).includes("::") ? str(w.travail_id).split("::")[0] : "");
}

/**
 * @param avant, apres   résultats de simulerPlanningGlobalV1
 * @param lundi          lundi ISO de la semaine affichée
 * @param evenements     absences / indisponibilités (planning_resource_events)
 * @param capaciteBase   (iso) → heures planifiables du jour (rythmeSemaine), injectée
 * @param ressourcesConsigne  identifiants à toujours afficher (la personne de la consigne)
 * @param chantierIds    périmètre affiché (vide = tous) : le moteur a planifié
 *                       TOUS les chantiers ensemble, on ne filtre que l'affichage
 * @param comparaison    "consigne" (défaut) ou "planning_actuel"
 */
export function construireApercuRecalculV1({
  avant, apres, lundi, evenements = [], capaciteBase = null, ressourcesConsigne = [], chantierIds = [], comparaison = "consigne",
} = {}) {
  const mode = COMPARAISONS.has(comparaison) ? comparaison : "consigne";
  const actuel = mode === "planning_actuel";
  const perimetre = new Set(uniq(chantierIds));
  const dansPerimetre = id => perimetre.size === 0 || perimetre.has(str(id));
  const filtrer = xs => (Array.isArray(xs) ? xs : []).filter(x => dansPerimetre(x?.chantier_id));
  const pA = proposition(avant);
  const pB = proposition(apres);
  // Toutes les lignes (tous chantiers) : pour dire où est une personne quand
  // sa case du périmètre est vide, et où part une tâche barrée.
  const toutesA = liste(pA.allocations_proposees);
  const toutesB = liste(pB.allocations_proposees);
  const allocA = filtrer(toutesA);
  const allocB = filtrer(toutesB);
  const npA = filtrer(pA.non_planifies);
  const npB = filtrer(pB.non_planifies);

  const ref = apres?.referentiel || avant?.referentiel || {};
  const nomChantier = new Map((ref.chantiers || []).map(c => [str(c.id), str(c.nom) || str(c.id)]));
  const nomRessource = new Map((ref.ressources || []).map(r => [str(r.id), str(r.nom_planning || r.nom) || str(r.id)]));
  const travaux = premierDe([apres, avant], "travaux_moteur") || [];
  const tachesPhasage = premierDe([apres, avant], "taches_phasage") || {};
  const nomTache = creerNomTacheV1({ allocations: [...toutesA, ...toutesB], travaux, tachesPhasage });
  const libelleTravail = (id, texteDirect) => nomTache(id, texteDirect);
  const tri = trierNonPlanifieesV1({
    nonPlanifies: liste(pB.non_planifies),
    travaux,
    travauxExclus: premierDe([apres, avant], "travaux_exclus") || [],
    allocations: toutesB,
    tachesPhasage,
    ressources: ref.ressources || [],
    horizon: apres?.horizon || avant?.horizon || {},
    capaciteBase,
    nomTache,
    nomChantier: id => nomChantier.get(str(id)) || null,
  });
  const npBIds = new Set(liste(pB.non_planifies).map(n => str(n.travail_id)));
  const exclusIds = new Set(liste(premierDe([apres, avant], "travaux_exclus")).map(x => str(x?.travail_id)).filter(Boolean));

  // 1. Ce qui change : le diff du chantier 05, entre la proposition d'avant
  //    (tenue pour « courant ») et celle d'après.
  const diff = diffReplanningV1({ forecast: allocA, proposition: { ...pB, allocations_proposees: allocB, non_planifies: npB }, travaux: [] });
  const changes = diff.changements.filter(c => c.statut !== "inchangé");
  const idsChanges = new Set(changes.map(c => c.travail_id));
  const datesParTravail = (rows) => {
    const m = new Map();
    rows.forEach(a => {
      const id = str(a.travail_id);
      if (!id) return;
      if (!m.has(id)) m.set(id, new Set());
      m.get(id).add(str(a.date));
    });
    return m;
  };
  const datesA = datesParTravail(allocA);
  const datesB = datesParTravail(allocB);

  const deplacees = changes
    .filter(c => c.statut === "modifié")
    .map(c => ({
      travail_id: c.travail_id,
      chantier_id: c.chantier_id,
      chantier: nomChantier.get(str(c.chantier_id)) || c.chantier_id,
      texte: libelleTravail(c.travail_id),
      avant: { debut: c.courant.debut, fin: c.courant.fin, ressources: c.courant.resource_ids.map(id => nomRessource.get(id) || id) },
      apres: { debut: c.propose.debut, fin: c.propose.fin, ressources: c.propose.resource_ids.map(id => nomRessource.get(id) || id) },
      decalage_debut_jours: c.impact.decalage_debut_jours,
      decalage_fin_jours: c.impact.decalage_fin_jours,
      details: c.details,
    }))
    .sort((a, b) => str(a.apres.debut).localeCompare(str(b.apres.debut)) || a.texte.localeCompare(b.texte, "fr"));

  const nouvelles = changes.filter(c => c.statut === "nouveau").map(c => ({
    travail_id: c.travail_id,
    chantier: nomChantier.get(str(c.chantier_id)) || c.chantier_id,
    texte: libelleTravail(c.travail_id),
    debut: c.propose.debut,
    fin: c.propose.fin,
  }));

  // 2. Non planifiées à cause du recalcul : absentes d'« avant », ou dont la
  //    raison a changé. Face au planning actuel : TOUTES celles du périmètre
  //    (le planning actuel ne connaît pas de « non planifiée »). La raison est
  //    celle du moteur, jamais reformulée.
  const npAvant = new Map(npA.map(n => [str(n.travail_id), n]));
  const nonPlanifiees = npB
    .filter(n => {
      if (actuel) return true;
      const a = npAvant.get(str(n.travail_id));
      return !a || str(a.raison_code) !== str(n.raison_code) || str(a.raison) !== str(n.raison);
    })
    .map(n => {
      const t = tri.get(str(n.travail_id)) || null;
      return {
        travail_id: str(n.travail_id),
        chantier_id: str(n.chantier_id) || null,
        chantier: nomChantier.get(str(n.chantier_id)) || n.chantier_id,
        texte: libelleTravail(n.travail_id),
        heures_mo_restantes: n.heures_mo_restantes,
        // Raison et code d'origine du moteur, inchangés.
        raison: str(n.raison) || "Raison non fournie par le moteur",
        raison_code: str(n.raison_code) || null,
        categorie: t?.categorie || BLOQUEE,
        racine: t?.racine || null,
        date_prevue: t?.date_prevue || null,
        date_prevue_apres_periode: !!t?.date_prevue_apres_periode,
        etait_planifiee: actuel ? datesA.has(str(n.travail_id)) : !npAvant.has(str(n.travail_id)),
      };
    });
  const nonPlanifieesTotal = npB.length;
  const triNonPlanifiees = regrouperNonPlanifieesV1(nonPlanifiees, { finPeriode: apres?.horizon?.end_date || avant?.horizon?.end_date });

  // 3. Conflits : avertissements qui n'existaient pas avant la consigne.
  const clesAvant = new Set(avertissementsDe(avant).map(cleAvertissement));
  const conflits = avertissementsDe(apres)
    .filter(w => !clesAvant.has(cleAvertissement(w)))
    .filter(w => !chantierDeAvertissement(w) || dansPerimetre(chantierDeAvertissement(w)))
    .map(w => ({ type: str(w.type), explication: str(w.explication) || str(w.type) }));

  // 4. Fins prévisionnelles qui bougent. Face au planning actuel, toutes
  //    celles du périmètre, et JAMAIS de fin pour le planning actuel : il ne
  //    dit pas si tout le reste à faire est posé. Seul le dernier jour posé
  //    est montré, comme un simple repère.
  const fmt = iso => libelleDateV1(iso, { court: true });
  const finsA = new Map(finPrevisionnelleParChantierV1({ allocations_proposees: allocA, non_planifies: npA }).chantiers.map(c => [c.chantier_id, c]));
  const finsB = finPrevisionnelleParChantierV1({ allocations_proposees: allocB, non_planifies: npB }).chantiers;
  const avantActuel = a => ({
    statut: "inconnu",
    titre: a?.derniere_date_allouee ? `dernier jour posé ${fmt(a.derniere_date_allouee)}` : "rien de posé",
    detail: null,
  });
  const fins = finsB
    .map(b => ({ b, a: finsA.get(b.chantier_id) || null }))
    .filter(({ a, b }) => actuel || !a || a.complet !== b.complet || a.fin_prevue !== b.fin_prevue || a.derniere_date_allouee !== b.derniere_date_allouee)
    .map(({ a, b }) => ({
      chantier_id: b.chantier_id,
      chantier: nomChantier.get(b.chantier_id) || b.chantier_id,
      avant: actuel ? avantActuel(a) : a ? libelleFinPrevisionnelleV1(a, fmt) : { statut: "inconnu", titre: "—", detail: null },
      apres: libelleFinPrevisionnelleV1(b, fmt),
      decalage_jours: !actuel && a && a.complet && b.complet && a.fin_prevue && b.fin_prevue ? ecartJoursV1(b.fin_prevue, a.fin_prevue) : null,
    }));
  const chantiersInchanges = finsB.length - fins.length;
  // Chantier demandé sur lequel le moteur ne propose rien : on le dit, plutôt
  // que de le laisser disparaître du bandeau.
  const avecFin = new Set(finsB.map(b => b.chantier_id));
  const chantiersSansTravail = [...perimetre]
    .filter(id => !avecFin.has(id))
    .map(id => ({ chantier_id: id, chantier: nomChantier.get(id) || id }));

  // 5. Grille de la semaine demandée.
  const lun = lundiDeLaSemaineV1(lundi) || lundiDeLaSemaineV1(apres?.horizon?.start_date);
  const jours = lun ? joursOuvresDeLaSemaine(lun).map(date => {
    const cap = typeof capaciteBase === "function" ? Number(capaciteBase(date)) : null;
    return { date, libelle: libelleDateV1(date, { court: true }), capacite: Number.isFinite(cap) ? cap : null, non_travaille: cap === 0 };
  }) : [];
  const dansSemaine = d => jours.some(j => j.date === str(d));
  const absencesSemaine = (Array.isArray(evenements) ? evenements : []).filter(e => e && e.actif !== false
    && ["absence", "indisponibilite"].includes(str(e.type))
    && jours.some(j => str(e.date_debut) <= j.date && str(e.date_fin || e.date_debut) >= j.date));

  const ressourcesVues = uniq([
    ...ressourcesConsigne,
    ...allocA.filter(a => dansSemaine(a.date)).flatMap(a => a.resource_ids || []),
    ...allocB.filter(a => dansSemaine(a.date)).flatMap(a => a.resource_ids || []),
    ...absencesSemaine.map(e => e.resource_id),
  ]).sort((x, y) => (nomRessource.get(x) || x).localeCompare(nomRessource.get(y) || y, "fr"));

  const item = (a, extra = {}) => ({
    travail_id: str(a.travail_id),
    chantier: nomChantier.get(str(a.chantier_id)) || str(a.chantier_id),
    texte: libelleTravail(a.travail_id, a.texte),
    duree: a.duree,
    exception: a.exception ? str(a.exception.explication) : null,
    ...extra,
  });

  // Où part une tâche barrée qui n'a plus aucune place visible dans la semaine.
  const dernierJour = jours.length ? jours[jours.length - 1].date : null;
  const destinationFantome = (id) => {
    const dates = [...new Set(toutesB.filter(a => str(a.travail_id) === id).map(a => str(a.date)))].sort();
    if (dates.some(dansSemaine)) return null;
    const plusTard = dates.find(d => dernierJour && d > dernierJour);
    if (plusTard) return { type: "deplacee", date: plusTard, libelle: `→ déplacée au ${court(plusTard)}` };
    if (dates.length) return { type: "avancee", date: dates[dates.length - 1], libelle: `→ avancée au ${court(dates[dates.length - 1])}` };
    if (npBIds.has(id)) return { type: "non_planifiee", date: null, libelle: "→ non planifiée (voir liste)" };
    if (exclusIds.has(id)) return { type: "exclue", date: null, libelle: "→ exclue du calcul automatique" };
    return { type: "rien_a_planifier", date: null, libelle: "→ plus rien à planifier selon le phasage" };
  };

  // Une case vide dit la vérité : la personne travaille ailleurs (hors du
  // périmètre affiché) ou elle est réellement libre.
  const occupation = (toutes, dansCase, rid, j, partielle) => {
    const ailleurs = toutes.filter(a => str(a.date) === j.date && (a.resource_ids || []).map(str).includes(rid) && !dansPerimetre(a.chantier_id));
    const parChantier = new Map();
    ailleurs.forEach(a => {
      const k = str(a.chantier_id);
      const prev = parChantier.get(k) || { chantier_id: k, chantier: nomChantier.get(k) || k, heures: 0 };
      prev.heures = arrondi(prev.heures + (Number(a.duree) || 0));
      parChantier.set(k, prev);
    });
    const autres = [...parChantier.values()].sort((x, y) => y.heures - x.heures || x.chantier.localeCompare(y.chantier, "fr"));
    const hAutres = arrondi(autres.reduce((s, c) => s + c.heures, 0));
    const hIci = arrondi(dansCase.reduce((s, a) => s + (Number(a.duree) || 0), 0));
    const libres = j.capacite == null ? null : arrondi(Math.max(0, j.capacite - (partielle || 0) - hIci - hAutres));
    const detail = autres.map(c => `${c.chantier} (${heuresTxt(c.heures)})`).join(", ");
    return {
      autres_chantiers: autres,
      heures_autres_chantiers: hAutres,
      heures_libres: libres,
      case_vide: dansCase.length ? null
        : autres.length ? { type: "autre_chantier", libelle: `Autre chantier · ${heuresTxt(hAutres)}`, detail }
          : { type: "libre", libelle: libres == null ? "Libre" : `Libre · ${heuresTxt(libres)} disponibles`, detail: null },
      en_plus: dansCase.length && autres.length ? { libelle: `+ Autre chantier · ${heuresTxt(hAutres)}`, detail } : null,
      // Case en partie remplie : le reste de la journée est dit, pas laissé blanc.
      reste_libre: dansCase.length && libres != null && libres >= 0.25 ? { libelle: `+ Libre · ${heuresTxt(libres)}`, detail: null } : null,
    };
  };

  const lignes = ressourcesVues.map(rid => ({
    resource_id: rid,
    nom: nomRessource.get(rid) || rid,
    cellules: jours.map(j => {
      const aA = allocA.filter(a => str(a.date) === j.date && (a.resource_ids || []).map(str).includes(rid));
      const aB = allocB.filter(a => str(a.date) === j.date && (a.resource_ids || []).map(str).includes(rid));
      const idsB = new Set(aB.map(a => str(a.travail_id)));
      const idsA = new Set(aA.map(a => str(a.travail_id)));
      const abs = absencesSemaine.filter(e => str(e.resource_id) === rid && str(e.date_debut) <= j.date && str(e.date_fin || e.date_debut) >= j.date);
      const dureeAvant = new Map(aA.map(a => [str(a.travail_id), Number(a.duree)]));
      const apresItems = aB.map(a => {
        const id = str(a.travail_id);
        // Même tâche, même personne, même jour, même durée : la case n'a pas
        // bougé, même si la tâche a changé ailleurs dans la semaine.
        const memeCase = idsA.has(id) && dureeAvant.get(id) === Number(a.duree);
        const change = idsChanges.has(id) && !memeCase;
        let origine = null;
        if (change && !idsA.has(id)) {
          const avantDates = [...(datesA.get(id) || [])].sort();
          const quittees = avantDates.filter(d => !(datesB.get(id) || new Set()).has(d));
          origine = quittees[0] || avantDates[0] || null;
        }
        return item(a, {
          change,
          deplace_depuis: origine,
          libelle_deplacement: !change ? null
            : origine ? `← décalé de ${libelleDateV1(origine, { court: true }).split(" ")[0]}`
              : idsA.has(id) ? "durée modifiée"
                : datesA.has(id) ? "déplacée" : "nouvelle place",
        });
      });
      const dureeApres = new Map(aB.map(a => [str(a.travail_id), Number(a.duree)]));
      const avantItems = aA.map(a => item(a, {
        change: idsChanges.has(str(a.travail_id)) && dureeApres.get(str(a.travail_id)) !== Number(a.duree),
      }));
      const fantomes = aA
        .filter(a => idsChanges.has(str(a.travail_id)) && !idsB.has(str(a.travail_id)))
        .map(a => item(a, { fantome: true, destination: destinationFantome(str(a.travail_id)) }));
      const absent = abs.some(e => e.toute_journee !== false);
      const partielle = abs.filter(e => e.toute_journee === false).map(e => Number(e.heures_indisponibles) || 0)[0] || null;
      const sansCase = o => (absent || j.non_travaille ? { ...o, case_vide: null } : o);
      return {
        date: j.date,
        absent,
        absence_partielle_h: partielle,
        avant: avantItems,
        apres: apresItems,
        occupation_avant: sansCase(occupation(toutesA, aA, rid, j, partielle)),
        occupation_apres: sansCase(occupation(toutesB, aB, rid, j, partielle)),
        fantomes,
        change: apresItems.some(i => i.change) || fantomes.length > 0,
      };
    }),
  }));

  const horsSemaine = deplacees.filter(d => !dansSemaine(d.avant.debut) && !dansSemaine(d.apres.debut)).length;

  return {
    version: ASSISTANT_PLANNING_APERCU_VERSION,
    comparaison: mode,
    chantier_ids: [...perimetre],
    lundi: lun,
    jours,
    lignes,
    deplacees,
    nouvelles,
    non_planifiees: nonPlanifiees,
    non_planifiees_total: nonPlanifieesTotal,
    non_planifiees_tri: triNonPlanifiees,
    conflits,
    fins,
    chantiers_fin_inchangee: chantiersInchanges,
    chantiers_sans_travail: chantiersSansTravail,
    hors_semaine: horsSemaine,
    resume: {
      deplacees: deplacees.length,
      nouvelles: nouvelles.length,
      non_planifiees: nonPlanifiees.length,
      bloquees: triNonPlanifiees.synthese.bloquees,
      apres_periode: triNonPlanifiees.synthese.apres_periode,
      conflits: conflits.length,
      chantiers_qui_glissent: fins.filter(f => (f.decalage_jours ?? 0) > 0 || (f.avant.statut === "complet" && f.apres.statut !== "complet")).length,
    },
    horizon: apres?.horizon || null,
    calcule_le: str(apres?.generated_at) || null,
  };
}

// ─── Planning actuel ↔ proposition du moteur (sans consigne) ────────────────

function heuresMoAllocationPosee(a) {
  const taille = uniq(a?.resource_ids).length || uniq(a?.ouvriers_noms).length;
  return Math.max(0, Number(a?.duree) || 0) * taille;
}

function travailIdPose(a) {
  return str(a?.tache_id) ? `${str(a.chantier_id)}::${str(a.tache_id)}` : `manuel::${str(a?.allocation_uid)}`;
}

/**
 * Aperçu « Planning actuel » / « Proposition du moteur » à partir d'UN
 * résultat de simulerPlanningGlobalV1 :
 *   - planning actuel = forecast_courant (lignes de planning_cells lues par
 *     allocationsDepuisCellules, adaptateur du planning de référence v1) :
 *     lignes recalculables + lignes figées (verrouillées ou manuelles) ;
 *   - proposition = allocations du moteur + ces mêmes lignes figées, que le
 *     moteur garde telles quelles (il ne les renvoie pas dans sa proposition).
 */
export function construireApercuPlanningActuelV1({ resultat, lundi, chantierIds = [], evenements = [], capaciteBase = null } = {}) {
  const fc = resultat?.forecast_courant || {};
  const recalculables = Array.isArray(fc.allocations_recalculables) ? fc.allocations_recalculables : [];
  const figees = (Array.isArray(fc.allocations_fixes) ? fc.allocations_fixes : [])
    .map(a => ({ ...a, travail_id: travailIdPose(a), heures_mo: heuresMoAllocationPosee(a) }));
  const planningActuel = [...recalculables.map(a => ({ ...a, travail_id: travailIdPose(a) })), ...figees];
  const pB = proposition(resultat);
  const avant = {
    referentiel: resultat?.referentiel,
    horizon: resultat?.horizon,
    proposition: { allocations_proposees: planningActuel, non_planifies: [], warnings: [] },
  };
  const apres = {
    ...(resultat || {}),
    proposition: { ...pB, allocations_proposees: [...(Array.isArray(pB.allocations_proposees) ? pB.allocations_proposees : []), ...figees] },
  };
  return construireApercuRecalculV1({ avant, apres, lundi, evenements, capaciteBase, chantierIds, comparaison: "planning_actuel" });
}
