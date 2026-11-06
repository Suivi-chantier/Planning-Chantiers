// ─────────────────────────────────────────────────────────────────────────────
// notificationsDirectionV1 — contenu et décisions des notifications F2, D2, D3
// et D4 (projet docs/projets/notifications-push.md, tâche 8).
//
//   F2 : encours fournisseurs du vendredi (comptable). Le total vient du calcul
//        du mail (encoursFournisseursV1.mjs) : ce module ne fait que l'écrire.
//   D2 : nouveau chantier signé (admin + conducteur). L'événement est l'étape
//        « Devis signé » du cycle de vie validée (refonte Opérations, lots 3 et
//        suivants), lue avec la même fonction que la fiche chantier et les
//        relances (cycleVie.etatsCycleVie : table chantier_cycle_vie, sinon
//        ancien cycle du phasage repris). On notifie une fois par chantier.
//   D3 : synthèse de la semaine (admin). Les chiffres sont ceux du bandeau du
//        Bilan semaine, produits par les MÊMES fonctions que l'écran
//        (bilanPeriodeV3 : activité, présélection, synthèse, bandeau), à partir
//        des colonnes des relevés journaliers. Rien n'est recalculé ici.
//   D4 : écart du contrôle du journal d'avancement (admin, boîte seule).
//
// RÈGLE 2 (D2) : on notifie un changement. L'état déjà vu est rangé dans
// public.notifications_etat, type « D2 », cle_objet = id du chantier, etat
// « signe ». Une ligne de référence (cle_objet « _reference ») marque le
// premier passage, même s'il n'y avait encore aucun chantier signé.
// PREMIER PASSAGE : aucune ligne D2 → tous les chantiers déjà signés sont
// enregistrés, RIEN n'est envoyé.
//
// RÈGLE 5 : une notification par type et par passage (« 2 nouveaux chantiers
// signés : X, Y »).
//
// Une impossibilité reste visible (CLAUDE.md) : D3 sans relevé de la semaine
// dit « relevé pas encore disponible », jamais un chiffre à 0.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────

import { lienPage } from "../../supabase/functions/_partage/notificationsPushV1.mjs";
import { etatsCycleVie } from "./cycleVie.mjs";
import { estChantierArchive, statutDuChantier, STATUT_PERDU, estChantierActif } from "./chantierActif.mjs";
import { ETAPE_SIGNATURE } from "./statutsChantier.mjs";
import { eurEncours } from "./encoursFournisseursV1.mjs";
import {
  periodeSemaineV3, semaineIsoV3, ajouterJoursV3, bornesComparaisonV3, indexerRelevesV3,
  activiteChantiersV3, preselectionChantiersV3, syntheseChantiersV3, bandeauV3,
} from "./bilanPeriodeV3.mjs";

export const NOTIFICATIONS_DIRECTION_VERSION = "v1";

const str = (v) => (v == null ? "" : String(v).trim());
const liste = (v) => (Array.isArray(v) ? v : []);
const jour = (v) => str(v).slice(0, 10);
const jjmm = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

/** Liste de noms, au plus `max`, puis « et N autres ». */
function listeNoms(noms, max = 8) {
  const l = noms.filter(Boolean);
  if (l.length <= max) return l.join(", ");
  return `${l.slice(0, max).join(", ")} et ${l.length - max} autre${l.length - max > 1 ? "s" : ""}`;
}

// ─── F2 — Encours fournisseurs du vendredi ──────────────────────────────────

/**
 * Notification F2, tirée du résultat de calculerEncoursFournisseursV1 (le
 * calcul du mail). Encours vide → null : rien à envoyer, comme le mail.
 * @param {{ mois: Array<{mois, aPayer}>, totalAPayer: number, dateParis: string }} p
 */
export function contenuPushF2V1({ mois, totalAPayer, dateParis } = {}) {
  const groupes = liste(mois);
  if (!groupes.length) return null;
  return {
    type: "F2",
    titre: `Encours fournisseurs : ${eurEncours(totalAPayer)} € HT à payer`,
    texte: `Total à payer sur les ${groupes.length} mois d'échéance les plus récents, détaillé par fournisseur dans l'encours (même calcul que le mail du vendredi).`,
    lien: lienPage("encours-fournisseurs"),
    cle_regroupement: `F2-${dateParis}`,
  };
}

// ─── D2 — Nouveau chantier signé ────────────────────────────────────────────

export const TYPE_D2 = "D2";
export const CLE_REFERENCE_D2 = "_reference";
export const ETAT_SIGNE = "signe";

/**
 * Chantiers dont l'étape « Devis signé » est validée, lus comme la fiche
 * chantier et les relances (phasage le plus récent par chantier pour l'ancien
 * cycle, table chantier_cycle_vie d'abord). Chantiers archivés ou perdus
 * exclus.
 * @returns {Array<{ chantierId: string, nom: string, dateSignature: string|null }>}
 */
export function chantiersSignesV1({ chantiers = [], lignesCycleVie = [], phasages = [] } = {}) {
  const phasageParChantier = new Map();
  liste(phasages).forEach((ph) => {
    if (!ph?.chantier_id) return;
    const cur = phasageParChantier.get(ph.chantier_id);
    if (!cur || String(ph.updated_at || "") > String(cur.updated_at || "")) phasageParChantier.set(ph.chantier_id, ph);
  });
  const lignesPar = new Map();
  liste(lignesCycleVie).forEach((l) => {
    const k = str(l?.chantier_id);
    if (!k) return;
    if (!lignesPar.has(k)) lignesPar.set(k, []);
    lignesPar.get(k).push(l);
  });
  const out = [];
  for (const c of liste(chantiers)) {
    if (!c || !str(c.id) || estChantierArchive(c) || statutDuChantier(c) === STATUT_PERDU) continue;
    const meta = phasageParChantier.get(c.id)?.plan_travaux?.meta || null;
    const { etats } = etatsCycleVie({ meta, lignes: lignesPar.get(str(c.id)) || [] });
    const e = etats?.[ETAPE_SIGNATURE];
    if (e?.fait !== true) continue;
    out.push({ chantierId: str(c.id), nom: str(c.nom) || str(c.id), dateSignature: jour(e?.donnees?.date) || jour(e?.date) || null });
  }
  return out;
}

/**
 * Plan d'un passage D2.
 * @param {{ signes: ReturnType<typeof chantiersSignesV1>, etatsStockes: Array<{type, cle_objet}>, dateParis: string }} p
 * @returns {{ premierPassage: boolean, nouveaux: Array, notification: object|null,
 *             ecritures: Array<{type, cle_objet, etat}> }}
 */
export function planD2V1({ signes = [], etatsStockes = [], dateParis } = {}) {
  const stockes = liste(etatsStockes).filter((e) => e?.type === TYPE_D2);
  const premierPassage = stockes.length === 0;
  const vus = new Set(stockes.map((e) => str(e.cle_objet)));
  const ecrire = (cle) => ({ type: TYPE_D2, cle_objet: cle, etat: ETAT_SIGNE });
  if (premierPassage) {
    return {
      premierPassage, nouveaux: [], notification: null,
      ecritures: [{ type: TYPE_D2, cle_objet: CLE_REFERENCE_D2, etat: "reference" }, ...liste(signes).map((s) => ecrire(s.chantierId))],
    };
  }
  const nouveaux = liste(signes).filter((s) => !vus.has(s.chantierId));
  return { premierPassage, nouveaux, notification: contenuPushD2V1({ nouveaux, dateParis }), ecritures: nouveaux.map((s) => ecrire(s.chantierId)) };
}

/** Notification D2 regroupée ; aucun nouveau chantier → null. */
export function contenuPushD2V1({ nouveaux = [], dateParis } = {}) {
  const l = liste(nouveaux);
  if (!l.length) return null;
  const nom = (s) => (s.dateSignature ? `${s.nom} (signé le ${jjmm(s.dateSignature)})` : s.nom);
  const un = l.length === 1 ? l[0] : null;
  return {
    type: TYPE_D2,
    titre: un ? `Nouveau chantier signé : ${un.nom}`.slice(0, 120) : `${l.length} nouveaux chantiers signés`,
    texte: un ? `${nom(un)}. Étape « Devis signé » validée dans le cycle de vie.` : `${listeNoms(l.map(nom))}.`,
    lien: un ? lienPage("chantiers", { chantier: un.chantierId }) : lienPage("operations"),
    cle_regroupement: `D2-${dateParis}`,
  };
}

// ─── D3 — Synthèse de la semaine ────────────────────────────────────────────

/** Chantiers proposés par le Bilan (même liste que BilanPeriode.jsx). */
export const CHANTIERS_EXCLUS_BILAN = Object.freeze(["DÉPOT"]);

/** Semaine écoulée (ISO « AAAA-Www ») vue d'un jour de Paris : la semaine d'il y a 7 jours. */
export function semaineEcouleeV1(dateParis) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(dateParis))) return null;
  return semaineIsoV3(ajouterJoursV3(dateParis, -7));
}

/**
 * Bandeau du Bilan semaine pour une semaine, avec les fonctions de l'écran.
 * Les données sont celles que lit BilanPeriode.jsx (useDonneesPeriode) :
 *   releves   : chantier_releves_journaliers (date_releve ≤ fin de période)
 *   pointages : { chantier_id, date, heures } (21 jours avant → fin)
 *   rapports  : { chantier_id, date_rapport, statut } des semaines de la période
 *   journal   : avancement_journal de la période
 *   commandes : { chantier_id, date } (date_doc dans la période)
 *   chantiers : chantiers au format de l'application (depuisLigneChantier)
 * Présélection par défaut (aucun choix manuel), comme à l'ouverture de l'écran.
 */
export function syntheseSemaineD3V1({ weekId, chantiers = [], releves = [], pointages = [], rapports = [], journal = [], commandes = [] } = {}) {
  const periode = periodeSemaineV3(weekId);
  if (!periode) return { ok: false, raison: `Semaine illisible : ${weekId}` };
  const joursTravailles = liste(pointages).filter((p) => Number(p.heures) > 0).map((p) => p.date);
  const bornes = bornesComparaisonV3(periode, joursTravailles);
  const enCours = liste(chantiers)
    .filter((c) => estChantierActif(c) && !CHANTIERS_EXCLUS_BILAN.includes(c.nom))
    .sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr"));
  const activite = activiteChantiersV3({ periode, pointages, rapports, journal, commandes });
  const retenus = preselectionChantiersV3({ chantiers: enCours, activite, choix: {} })
    .filter((p) => p.coche).map((p) => ({ id: p.chantierId, nom: p.nom }));
  const idx = indexerRelevesV3(releves);
  const synthese = syntheseChantiersV3({ releves: idx, chantiers: retenus, bornes, periode });
  const bandeau = bandeauV3({ synthese });
  // Relevé de la semaine : le contrôle de nuit écrit un relevé pour chaque
  // chantier qui a bougé. Aucun relevé daté du dernier jour travaillé de la
  // semaine = relevé pas encore écrit (ou semaine sans travail) : les
  // chiffres seraient ceux d'un autre jour. Ce n'est pas « 0 € ».
  const releveDuJour = liste(releves).some((r) => jour(r.date_releve) === bornes.dateFin);
  const nbDisponibles = synthese.filter((s) => s.disponible).length;
  const releveDisponible = !bornes.sansJourTravaille && releveDuJour && nbDisponibles > 0;
  return { ok: true, periode, bornes, retenus: retenus.length, nbDisponibles, releveDisponible, bandeau, synthese };
}

// Formats de l'écran du Bilan (BilanPeriode.jsx : fmtEur, fmtEurSigne, fmtH, fmtPctSur).
const fmtEur = (v) => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} €`);
const fmtEurSigne = (v) => (v == null ? "—" : `${v > 0.5 ? "+" : v < -0.5 ? "−" : ""}${Math.round(Math.abs(v)).toLocaleString("fr-FR")} €`);
const fmtH = (v) => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")} h`);
const fmtPctSur = (v) => {
  if (v == null) return "—";
  const r = Math.round(v);
  return `${r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("fr-FR")} %`;
};

/** Notification D3, à partir de syntheseSemaineD3V1. Toujours un contenu (l'absence de relevé est dite). */
export function contenuPushD3V1(s) {
  const weekId = s?.periode?.weekId || "";
  const n = Number(/W(\d+)/.exec(weekId)?.[1]) || weekId;
  const base = { type: "D3", lien: lienPage("bilan-semaine"), cle_regroupement: `D3-${weekId}` };
  if (!s?.ok || !s.releveDisponible) {
    return { ...base, titre: `Synthèse de la semaine ${n}`,
      texte: "Relevé pas encore disponible : aucun chiffre pour cette semaine. Ouvrez le Bilan semaine plus tard." };
  }
  const b = s.bandeau;
  return {
    ...base,
    titre: `Synthèse de la semaine ${n}`,
    texte: `Production de la période ${fmtEur(b.production)} · marge de la période ${fmtEurSigne(b.margePeriode)} (${fmtPctSur(b.margePeriodePct)} de la production) · ${fmtH(b.heuresValidees)} validées, ${s.retenus} chantier${s.retenus > 1 ? "s" : ""}. Détail dans le Bilan semaine.`,
  };
}

// ─── D4 — Écart du contrôle du journal d'avancement ─────────────────────────

/**
 * Notification D4 (boîte seule) à partir de la réponse de
 * avancement_journal_reconcilier ({ ok, nb_taches, nb_ecarts }). Écart nul,
 * absent ou réponse illisible → null (rien à écrire).
 */
export function contenuPushD4V1({ resultat, dateParis } = {}) {
  const nb = Number(resultat?.nb_ecarts);
  if (resultat?.ok !== true || !Number.isFinite(nb) || nb <= 0) return null;
  const taches = Number(resultat?.nb_taches);
  return {
    type: "D4",
    titre: `Journal d'avancement : ${nb} écart${nb > 1 ? "s" : ""} au contrôle de nuit`,
    texte: `${nb} tâche${nb > 1 ? "s" : ""}${Number.isFinite(taches) ? ` sur ${taches}` : ""} avai${nb > 1 ? "ent" : "t"} un avancement absent du journal. Le contrôle les a ajoutées (lignes « reconciliation ») ; un chemin d'écriture échappe au journal et doit être corrigé. Compteur dans Réglages.`,
    lien: lienPage("admin"),
    cle_regroupement: `D4-${dateParis}`,
  };
}
