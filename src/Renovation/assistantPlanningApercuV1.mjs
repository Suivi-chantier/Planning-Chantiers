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
import { ajouterJoursV1, dateISOv1, ecartJoursV1, libelleDateV1, lundiDeLaSemaineV1 } from "./assistantPlanningConsigneV1.mjs";

export const ASSISTANT_PLANNING_APERCU_VERSION = 1;

const str = v => String(v ?? "").trim();
const uniq = xs => [...new Set((Array.isArray(xs) ? xs : []).map(str).filter(Boolean))];

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
  const allocA = filtrer(pA.allocations_proposees);
  const allocB = filtrer(pB.allocations_proposees);
  const npA = filtrer(pA.non_planifies);
  const npB = filtrer(pB.non_planifies);

  const ref = apres?.referentiel || avant?.referentiel || {};
  const nomChantier = new Map((ref.chantiers || []).map(c => [str(c.id), str(c.nom) || str(c.id)]));
  const nomRessource = new Map((ref.ressources || []).map(r => [str(r.id), str(r.nom_planning || r.nom) || str(r.id)]));
  const texteTravail = new Map();
  [...allocA, ...allocB].forEach(a => { if (str(a.travail_id) && str(a.texte) && !texteTravail.has(str(a.travail_id))) texteTravail.set(str(a.travail_id), str(a.texte)); });
  const libelleTravail = (id, tacheId) => texteTravail.get(str(id)) || str(tacheId) || str(id);

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
      texte: libelleTravail(c.travail_id, c.tache_id),
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
    texte: libelleTravail(c.travail_id, c.tache_id),
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
    .map(n => ({
      travail_id: str(n.travail_id),
      chantier: nomChantier.get(str(n.chantier_id)) || n.chantier_id,
      texte: libelleTravail(n.travail_id, n.tache_id),
      heures_mo_restantes: n.heures_mo_restantes,
      raison: str(n.raison) || "Raison non fournie par le moteur",
      raison_code: str(n.raison_code) || null,
      etait_planifiee: actuel ? datesA.has(str(n.travail_id)) : !npAvant.has(str(n.travail_id)),
    }));
  const nonPlanifieesTotal = npB.length;

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
    texte: libelleTravail(a.travail_id, a.tache_id),
    duree: a.duree,
    exception: a.exception ? str(a.exception.explication) : null,
    ...extra,
  });

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
        .map(a => item(a, { fantome: true }));
      return {
        date: j.date,
        absent: abs.some(e => e.toute_journee !== false),
        absence_partielle_h: abs.filter(e => e.toute_journee === false).map(e => Number(e.heures_indisponibles) || 0)[0] || null,
        avant: avantItems,
        apres: apresItems,
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
    conflits,
    fins,
    chantiers_fin_inchangee: chantiersInchanges,
    chantiers_sans_travail: chantiersSansTravail,
    hors_semaine: horsSemaine,
    resume: {
      deplacees: deplacees.length,
      nouvelles: nouvelles.length,
      non_planifiees: nonPlanifiees.length,
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
