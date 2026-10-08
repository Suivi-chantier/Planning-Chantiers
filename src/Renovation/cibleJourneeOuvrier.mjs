// ─── CIBLE D'HEURES DE LA JOURNÉE D'UN OUVRIER ───────────────────────────────
// Module pur (aucun accès Supabase, aucune horloge) : les données arrivent en
// paramètre. Utilisé par le compte rendu ouvrier (RapportMobile) ET par le
// garde-fou de validation du conducteur (Validation) — même chiffre, même
// explication des deux côtés.
//
// Cible = heures du jour (exception de date Admin > rythme 4j/5j)
//         − indisponibilités de l'ouvrier saisies dans Réglages → Ressources
//           (table planning_resource_events, types absence / indisponibilite).
// Règles alignées sur la capacité du planning (planningResourceModelV1) :
//   - « journée entière » (toute_journee sans nombre d'heures) → cible 0 ;
//   - partielle → on retire heures_indisponibles, jamais en dessous de 0 ;
//   - « capacité exceptionnelle » (capacite_override) ne touche PAS la cible :
//     c'est une capacité de planification, pas un temps de présence.

const TYPES_RETRAIT = new Set(["absence", "indisponibilite"]);
const LIBELLES = { absence: "absence", indisponibilite: "indisponibilité" };

const str = v => String(v ?? "").trim();
const num = v => {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const arrondi = h => Math.round(h * 100) / 100;
const normNom = s => str(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Durée lisible, même format que rythmeSemaine.fmtHeures : 3.75 → "3h45".
const fmtH = h => {
  const min = Math.round((Number(h) || 0) * 60);
  const hh = Math.floor(min / 60), mm = min % 60;
  return mm ? `${hh}h${String(mm).padStart(2, "0")}` : `${hh}h`;
};

// Fiche ressource de l'ouvrier : compte lié d'abord, sinon prénom du planning.
export function ressourceDeLOuvrier(ressources, { authUserId = null, prenom = "" } = {}) {
  const liste = Array.isArray(ressources) ? ressources : [];
  if (authUserId) {
    const parCompte = liste.find(r => r?.auth_user_id && r.auth_user_id === authUserId);
    if (parCompte) return parCompte;
  }
  const cle = normNom(prenom);
  if (!cle) return null;
  const parNom = liste.filter(r => normNom(r?.nom_planning || r?.nom) === cle);
  return parNom.length === 1 ? parNom[0] : null;
}

// Indisponibilités de la ressource qui couvrent la date (AAAA-MM-JJ).
export function indisponibilitesDuJour(evenements, resourceId, dateISO) {
  const d = str(dateISO).slice(0, 10);
  if (!resourceId || !d) return [];
  return (Array.isArray(evenements) ? evenements : []).filter(e => {
    if (!e || e.actif === false || e.resource_id !== resourceId) return false;
    if (!TYPES_RETRAIT.has(e.type)) return false;
    const debut = str(e.date_debut).slice(0, 10);
    const fin = str(e.date_fin || e.date_debut).slice(0, 10);
    return !!debut && d >= debut && d <= fin;
  });
}

/**
 * @param heuresJour   heures attendues avant absences (exception de date ou rythme)
 * @param evenements   lignes planning_resource_events (déjà filtrées ou non)
 * @param resourceId   id planning_resources de l'ouvrier (null = inconnu)
 * @param dateISO      date du compte rendu, AAAA-MM-JJ
 * @returns { cible, heuresJour, retraitHeures, journeeEntiere, motifs, explication }
 *   explication = null quand aucune absence ne s'applique.
 */
export function cibleJourneeOuvrier({ heuresJour, evenements = [], resourceId = null, dateISO = "" } = {}) {
  const base = Math.max(0, num(heuresJour) ?? 0);
  const actifs = indisponibilitesDuJour(evenements, resourceId, dateISO);
  if (actifs.length === 0 || base === 0) {
    return { cible: arrondi(base), heuresJour: arrondi(base), retraitHeures: 0, journeeEntiere: false, motifs: [], explication: null };
  }

  let journeeEntiere = false;
  let retrait = 0;
  const motifs = [];
  for (const e of actifs) {
    const h = num(e.heures_indisponibles);
    const entiere = e.toute_journee !== false && h == null;
    if (entiere) journeeEntiere = true;
    else retrait += Math.max(0, h ?? 0);
    motifs.push(str(e.motif) || LIBELLES[e.type] || "absence");
  }
  const cible = journeeEntiere ? 0 : Math.max(0, base - retrait);
  const retraitHeures = arrondi(base - cible);
  const quoi = motifs.join(", ");
  const explication = journeeEntiere
    ? `Absence toute la journée (${quoi}) : aucune heure attendue au lieu de ${fmtH(base)}.`
    : `${fmtH(base)} − ${fmtH(retraitHeures)} d'absence (${quoi}) = ${fmtH(cible)} attendues.`;
  return { cible: arrondi(cible), heuresJour: arrondi(base), retraitHeures, journeeEntiere, motifs, explication };
}
