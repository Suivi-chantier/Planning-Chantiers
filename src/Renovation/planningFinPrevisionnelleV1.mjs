// ─────────────────────────────────────────────────────────────────────────────
// Fin prévisionnelle par chantier (Chantier 07, premier livrable).
//
// Module de calcul PUR : aucune dépendance, aucun accès Supabase, aucune
// horloge, aucun effet de bord, aucune écriture. Extension .mjs = parsable ESM
// par Node sans build (scripts de vérification), comme les autres modules purs
// du dossier.
//
// Entrée : le résultat du moteur `planningEngineV1` (ou l'objet `proposition`
// d'une simulation), qui porte :
//  - `allocations_proposees[]` : { chantier_id, date, heures_mo, tache_id… }
//  - `non_planifies[]`         : les travaux que le moteur n'a PAS pu placer
//                                dans l'horizon, avec heures_mo_restantes.
//
// ⚠️ INVARIANT DU PROJET — ne JAMAIS annoncer une fin qui n'en est pas une.
// Un chantier dont un seul travail reste dans `non_planifies` n'a PAS de date
// de fin connue : sa dernière date allouée n'est qu'un MINIMUM. Ce module ne
// moyenne rien, n'extrapole rien et n'invente aucune date au-delà de
// l'horizon : quand il ne sait pas, il le dit (`complet: false`, `fin_prevue`
// laissée à null, minimum exposé séparément par `derniere_date_allouee`).
//
// Conventions :
//  - dates au format ISO "YYYY-MM-DD" (comparables par ordre alphabétique) ;
//  - null = indéterminé — jamais une date inventée, jamais 0 déguisé en date ;
//  - une entrée vide ou malformée ne casse rien : elle produit une liste vide.
// ─────────────────────────────────────────────────────────────────────────────

export const PLANNING_FIN_PREVISIONNELLE_VERSION = "fin_previsionnelle_v1";

const str = v => (v == null ? "" : String(v).trim());
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Une date exploitable = chaîne ISO "YYYY-MM-DD" (on tolère un horodatage
// complet en ne gardant que le jour). Tout le reste est ignoré : mieux vaut
// « — » qu'une date fausse.
const dateISO = v => {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const listeSure = v => (Array.isArray(v) ? v : []);

// Le moteur renvoie l'objet complet, mais une simulation l'imbrique sous
// `proposition`. On accepte les deux sans rien deviner de plus.
function extraireProposition(resultat) {
  if (!resultat || typeof resultat !== "object") return { allocations: [], nonPlanifies: [] };
  const source = Array.isArray(resultat.allocations_proposees) || Array.isArray(resultat.non_planifies)
    ? resultat
    : (resultat.proposition && typeof resultat.proposition === "object" ? resultat.proposition : {});
  return {
    allocations: listeSure(source.allocations_proposees),
    nonPlanifies: listeSure(source.non_planifies),
  };
}

/**
 * Calcule la fin prévisionnelle de CHAQUE chantier présent dans le résultat
 * du moteur.
 *
 * @returns {{
 *   version: string,
 *   chantiers: Array<{
 *     chantier_id: string,
 *     fin_prevue: string|null,            // date seulement si complet
 *     derniere_date_allouee: string|null, // minimum, même si incomplet
 *     premiere_date_allouee: string|null,
 *     complet: boolean,
 *     nb_allocations: number,
 *     heures_mo_allouees: number,
 *     heures_non_planifiees: number,
 *     nb_travaux_non_planifies: number,
 *   }>,
 *   resume: { chantiers: number, complets: number, incomplets: number,
 *             sans_allocation: number, heures_non_planifiees: number },
 * }}
 */
export function finPrevisionnelleParChantierV1(resultatMoteur) {
  const { allocations, nonPlanifies } = extraireProposition(resultatMoteur);
  const parChantier = new Map();

  const entree = chantierId => {
    let e = parChantier.get(chantierId);
    if (!e) {
      e = {
        chantier_id: chantierId,
        fin_prevue: null,
        derniere_date_allouee: null,
        premiere_date_allouee: null,
        complet: true,
        nb_allocations: 0,
        heures_mo_allouees: 0,
        heures_non_planifiees: 0,
        nb_travaux_non_planifies: 0,
      };
      parChantier.set(chantierId, e);
    }
    return e;
  };

  for (const a of allocations) {
    if (!a || typeof a !== "object") continue;
    const chantierId = str(a.chantier_id);
    if (!chantierId) continue; // une allocation sans chantier n'appartient à personne
    const e = entree(chantierId);
    e.nb_allocations += 1;
    e.heures_mo_allouees += num(a.heures_mo);
    const d = dateISO(a.date);
    if (!d) continue; // date illisible : elle ne peut ni avancer ni reculer la fin
    if (e.derniere_date_allouee == null || d > e.derniere_date_allouee) e.derniere_date_allouee = d;
    if (e.premiere_date_allouee == null || d < e.premiere_date_allouee) e.premiere_date_allouee = d;
  }

  for (const n of nonPlanifies) {
    if (!n || typeof n !== "object") continue;
    const chantierId = str(n.chantier_id);
    if (!chantierId) continue;
    const e = entree(chantierId);
    e.complet = false; // un seul travail hors horizon suffit : la fin est inconnue
    e.nb_travaux_non_planifies += 1;
    e.heures_non_planifiees += Math.max(0, num(n.heures_mo_restantes ?? n.heures_restantes));
  }

  const chantiers = [...parChantier.values()].map(e => ({
    ...e,
    // La date n'est publiée comme FIN que si le chantier est entièrement placé.
    fin_prevue: e.complet ? e.derniere_date_allouee : null,
    heures_mo_allouees: round2(e.heures_mo_allouees),
    heures_non_planifiees: round2(e.heures_non_planifiees),
  }));

  chantiers.sort(comparerPourAffichage);

  return {
    version: PLANNING_FIN_PREVISIONNELLE_VERSION,
    chantiers,
    resume: {
      chantiers: chantiers.length,
      complets: chantiers.filter(c => c.complet).length,
      incomplets: chantiers.filter(c => !c.complet).length,
      sans_allocation: chantiers.filter(c => c.derniere_date_allouee == null).length,
      heures_non_planifiees: round2(chantiers.reduce((s, c) => s + c.heures_non_planifiees, 0)),
    },
  };
}

// Tri d'affichage : les chantiers dont la fin est connue d'abord, par date
// croissante ; les incomplets regroupés à la fin. À date égale (ou absente),
// l'identifiant départage pour rester déterministe.
function comparerPourAffichage(a, b) {
  if (a.complet !== b.complet) return a.complet ? -1 : 1;
  const da = a.complet ? a.fin_prevue : a.derniere_date_allouee;
  const db = b.complet ? b.fin_prevue : b.derniere_date_allouee;
  if (da !== db) {
    if (da == null) return 1; // « — » en dernier dans son groupe
    if (db == null) return -1;
    return da < db ? -1 : 1;
  }
  return a.chantier_id.localeCompare(b.chantier_id);
}

/**
 * Traduit une ligne en libellés d'écran. Aucune date sèche n'est produite pour
 * un chantier incomplet : le texte porte l'incertitude.
 *
 * @param {object} ligne   une entrée de `chantiers`
 * @param {(iso:string)=>string} formaterDate  formatage jour/mois/année
 */
export function libelleFinPrevisionnelleV1(ligne, formaterDate = d => d) {
  if (!ligne || typeof ligne !== "object") {
    return { statut: "inconnu", titre: "—", detail: "Aucune donnée pour ce chantier." };
  }
  if (ligne.complet && ligne.fin_prevue) {
    return { statut: "complet", titre: `Fin prévue le ${formaterDate(ligne.fin_prevue)}`, detail: null };
  }
  if (!ligne.complet) {
    const heures = round2(ligne.heures_non_planifiees);
    const travaux = Math.max(0, Math.round(num(ligne.nb_travaux_non_planifies)));
    const minimum = ligne.derniere_date_allouee
      ? `pas avant le ${formaterDate(ligne.derniere_date_allouee)}`
      : "aucun créneau trouvé dans l'horizon";
    return {
      statut: "au_dela_horizon",
      titre: "Au-delà de l'horizon",
      detail: `${minimum} · ${heures} h encore à placer sur ${travaux} ${travaux > 1 ? "travaux" : "travail"}`,
    };
  }
  // Complet sans aucune allocation : rien n'a été proposé, on n'invente pas.
  return { statut: "inconnu", titre: "—", detail: "Aucun créneau proposé sur cet horizon." };
}
